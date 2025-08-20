import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = JSON.parse(
    typeof __firebase_config !== 'undefined' 
    ? __firebase_config 
    : JSON.stringify({
        apiKey: "AIzaSyAI-0lpgoYcXcgrlqHF_mIF9IqiaRqw1bY",
        authDomain: "imposter-game-f4e36.firebaseapp.com",
        projectId: "imposter-game-f4e36",
        storageBucket: "imposter-game-f4e36.appspot.com",
        messagingSenderId: "622941194586",
        appId: "1:622941194586:web:376be19c5d9de2e5eccb63",
        measurementId: "G-W7XJKDDCZK"
    })
);

// --- App Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-imposter-game';
const gamesCollectionPath = `artifacts/${appId}/public/data/games`;

// --- Global State ---
let currentUserId = null;
let currentGameId = null;
let gameUnsubscribe = null;

// --- UI Elements ---
const screens = {
    loading: document.getElementById('loading-screen'),
    home: document.getElementById('home-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
};

// --- Word List ---
const wordList = ["Apple", "Banana", "Carrot", "Internet", "Java", "Kiwi", "Sun", "Moon", "Dog", "Cat", "Car", "Bicycle"];
const getRandomWord = () => wordList[Math.floor(Math.random() * wordList.length)];

// --- UI Control ---
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.add('hidden'));
    if (screens[screenName]) {
        screens[screenName].classList.remove('hidden');
    }
}

// --- Render Functions ---
function renderLobby(gameData) {
    document.getElementById('lobbyGameId').textContent = gameData.gameId;
    document.getElementById('gameScreenId').textContent = gameData.gameId;
    document.getElementById('playerCount').textContent = gameData.players.length;
    
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    gameData.players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'bg-gray-50 p-3 rounded-md text-left';
        playerDiv.innerHTML = `<p class="font-semibold text-gray-800">${player.name} ${player.isHost ? '(Host)' : ''}</p>`;
        playerList.appendChild(playerDiv);
    });

    const me = gameData.players.find(p => p.uid === currentUserId);
    const startGameBtn = document.getElementById('startGameBtn');
    const waitingForHost = document.getElementById('waitingForHost');

    if (me?.isHost) {
        startGameBtn.classList.remove('hidden');
        waitingForHost.classList.add('hidden');
        startGameBtn.disabled = gameData.players.length < 2;
        startGameBtn.textContent = gameData.players.length < 2 ? 'Need 2+ players' : 'Start Game';
    } else {
        startGameBtn.classList.add('hidden');
        waitingForHost.classList.remove('hidden');
    }
}

function renderGame(gameData) {
    const me = gameData.players.find(p => p.uid === currentUserId);
    const isMyTurn = gameData.currentPlayerUid === currentUserId;
    const gameContent = document.getElementById('game-content');
    
    let playersHTML = gameData.players.map(player => {
        const wordsForPlayer = gameData.words.filter(w => w.uid === player.uid).map(w => w.word).join(', ');
        const isCurrentPlayer = gameData.currentPlayerUid === player.uid;
        const canVote = player.uid !== currentUserId && gameData.status === 'voting' && !(gameData.votes && gameData.votes[currentUserId]);
        
        return `
            <div class="p-4 rounded-lg shadow-md ${isCurrentPlayer && gameData.status === 'playing' ? 'bg-yellow-200 ring-2 ring-yellow-500' : 'bg-white'}">
                <p class="font-bold text-gray-800">${player.name}</p>
                <p class="text-xl font-light text-gray-600 mt-2 h-auto min-h-[2.5rem]">${wordsForPlayer || '...'}</p>
                ${canVote ? `<button data-vote-uid="${player.uid}" class="vote-btn mt-2 w-full bg-blue-500 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">Vote</button>` : ''}
            </div>
        `;
    }).join('');

    let turnHTML = '';
    if (gameData.status === 'playing' && isMyTurn) {
        turnHTML = `
            <div class="mt-6 p-4 bg-white rounded-lg shadow-md">
                <h3 class="text-xl font-bold text-center text-gray-800">Round ${gameData.round}: It's your turn!</h3>
                <div class="flex gap-2 mt-2">
                    <input id="wordInput" type="text" placeholder="Enter your word..." class="flex-grow p-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <button id="submitWordBtn" class="bg-blue-500 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700">Submit</button>
                </div>
            </div>
        `;
    } else if (gameData.status === 'voting') {
         turnHTML = `
            <div class="mt-6 p-4 bg-white rounded-lg shadow-md text-center">
                <h3 class="text-2xl font-bold text-gray-800">Vote for the Imposter!</h3>
                <p class="text-gray-600">${(gameData.votes && gameData.votes[currentUserId]) ? 'Waiting for others...' : 'Click vote on a player card.'}</p>
            </div>
         `;
    }

    gameContent.innerHTML = `
        <div class="text-center mb-6">
            <h2 class="text-2xl font-light text-gray-700">Your Word Is:</h2>
            <p class="text-5xl font-bold text-blue-600">${me.role === 'imposter' ? '???' : gameData.secretWord}</p>
            <p class="text-lg font-semibold mt-2 text-red-500">${me.role.toUpperCase()}</p>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            ${playersHTML}
        </div>
        ${turnHTML}
    `;
}

function renderRoundEnd(gameData) {
    const gameContent = document.getElementById('game-content');
    const myChoice = gameData.roundChoices ? gameData.roundChoices[currentUserId] : null;

    let playersHTML = gameData.players.map(player => {
        const wordsForPlayer = gameData.words.filter(w => w.uid === player.uid).map(w => w.word).join(', ');
        return `
            <div class="p-4 rounded-lg shadow-md bg-white">
                <p class="font-bold text-gray-800">${player.name}</p>
                <p class="text-xl font-light text-gray-600 mt-2 h-auto min-h-[2.5rem]">${wordsForPlayer || '...'}</p>
            </div>
        `;
    }).join('');

    let choiceHTML = '';
    if (myChoice) {
        choiceHTML = `<p class="text-lg text-gray-700 mt-4">You chose to ${myChoice}. Waiting for other players...</p>`;
    } else {
        choiceHTML = `
            <div class="flex gap-4 mt-4">
                <button id="continueBtn" class="flex-1 bg-green-500 text-white font-bold py-3 px-6 rounded-lg hover:bg-green-700">Continue to Next Round</button>
                <button id="voteNowBtn" class="flex-1 bg-red-500 text-white font-bold py-3 px-6 rounded-lg hover:bg-red-700">Vote Now</button>
            </div>
        `;
    }

    gameContent.innerHTML = `
        <div class="text-center bg-white p-8 rounded-lg shadow-xl">
            <h2 class="text-3xl font-bold mb-4">End of Round ${gameData.round - 1}</h2>
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">${playersHTML}</div>
            ${choiceHTML}
        </div>
    `;
}

function renderFinished(gameData) {
    const gameContent = document.getElementById('game-content');
    const imposter = gameData.players.find(p => p.role === 'imposter');
    const votedOutPlayer = gameData.players.find(p => p.uid === gameData.votedOutUid);
    const me = gameData.players.find(p => p.uid === currentUserId);

    let playersHTML = gameData.players.map(player => {
        const wordsForPlayer = gameData.words.filter(w => w.uid === player.uid).map(w => w.word).join(', ');
        return `
            <div class="p-4 rounded-lg shadow-md bg-white">
                <div class="flex justify-between items-center">
                    <p class="font-bold text-gray-800">${player.name}</p>
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${player.role === 'imposter' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}">${player.role.toUpperCase()}</span>
                </div>
                <p class="text-xl font-light text-gray-600 mt-2 h-auto min-h-[2.5rem]">${wordsForPlayer}</p>
            </div>
        `;
    }).join('');

    gameContent.innerHTML = `
        <div class="text-center bg-white p-8 rounded-lg shadow-xl">
            <h2 class="text-4xl font-bold mb-4">${gameData.winner} Wins!</h2>
            <p class="text-xl mb-2">The secret word was: <span class="font-bold text-blue-600">${gameData.secretWord}</span></p>
            <p class="text-xl mb-2">The imposter was: <span class="font-bold text-red-600">${imposter.name}</span></p>
            <p class="text-xl mb-6">You voted out: <span class="font-bold text-gray-800">${votedOutPlayer?.name || 'Nobody'}</span></p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">${playersHTML}</div>
            ${me.isHost ? `<button id="playAgainBtn" class="bg-green-500 text-white font-bold py-3 px-6 rounded-lg hover:bg-green-700">Play Again</button>` : '<p>Waiting for host to start a new game...</p>'}
        </div>
    `;
}

// --- Game Logic Handlers ---
async function handleCreateGame() {
    const playerName = document.getElementById('playerName').value.trim();
    if (!playerName || !currentUserId) return;

    const gameRef = doc(collection(db, gamesCollectionPath));
    const newGameId = gameRef.id.substring(0, 6).toUpperCase();
    
    const hostPlayer = { uid: currentUserId, name: playerName, isHost: true };
    const newGameData = {
        gameId: newGameId,
        status: 'lobby',
        players: [hostPlayer],
        words: [],
        votes: {},
        round: 1,
        roundChoices: {},
        createdAt: new Date(),
    };

    await setDoc(doc(db, gamesCollectionPath, newGameId), newGameData);
    joinGame(newGameId);
}

async function handleJoinGame() {
    const playerName = document.getElementById('playerName').value.trim();
    const gameId = document.getElementById('joinGameIdInput').value.trim().toUpperCase();
    if (!playerName || !gameId || !currentUserId) return;

    const gameRef = doc(db, gamesCollectionPath, gameId);
    const gameSnap = await getDoc(gameRef);

    if (gameSnap.exists()) {
        const gameData = gameSnap.data();
        if (!gameData.players.find(p => p.uid === currentUserId)) {
            const newPlayer = { uid: currentUserId, name: playerName, isHost: false };
            await updateDoc(gameRef, { players: [...gameData.players, newPlayer] });
        }
        joinGame(gameId);
    } else {
        alert("Game not found!");
    }
}

function joinGame(gameId) {
    currentGameId = gameId;
    if (gameUnsubscribe) gameUnsubscribe();

    gameUnsubscribe = onSnapshot(doc(db, gamesCollectionPath, gameId), (doc) => {
        if (doc.exists()) {
            const gameData = doc.data();
            switch (gameData.status) {
                case 'lobby':
                    renderLobby(gameData);
                    showScreen('lobby');
                    break;
                case 'playing':
                case 'voting':
                    renderGame(gameData);
                    showScreen('game');
                    break;
                case 'round-end':
                    renderRoundEnd(gameData);
                    showScreen('game');
                    break;
                case 'finished':
                    renderFinished(gameData);
                    showScreen('game');
                    break;
            }
        } else {
            alert("Game not found or has been deleted.");
            leaveGame();
        }
    });
}

function leaveGame() {
    if (gameUnsubscribe) gameUnsubscribe();
    currentGameId = null;
    gameUnsubscribe = null;
    showScreen('home');
}

// --- Event Listeners Setup ---
document.getElementById('createGameBtn').addEventListener('click', handleCreateGame);
document.getElementById('joinGameBtn').addEventListener('click', handleJoinGame);
document.getElementById('copyGameIdBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(currentGameId);
    alert('Game ID copied!');
});

document.getElementById('lobby-screen').addEventListener('click', async (e) => {
    if (e.target.id === 'startGameBtn') {
        const gameRef = doc(db, gamesCollectionPath, currentGameId);
        const gameSnap = await getDoc(gameRef);
        if (!gameSnap.exists()) return;
        
        const gameData = gameSnap.data();
        const secretWord = getRandomWord();
        const imposterIndex = 1 + Math.floor(Math.random() * (gameData.players.length - 1));
        const playersWithRoles = gameData.players.map((p, i) => ({...p, role: i === imposterIndex ? 'imposter' : 'crew'}));

        await updateDoc(gameRef, {
            status: 'playing',
            players: playersWithRoles,
            secretWord: secretWord,
            currentPlayerUid: gameData.players[0].uid,
            round: 1,
            roundChoices: {},
            words: [],
            votes: {},
        });
    }
});

document.getElementById('game-screen').addEventListener('click', async (e) => {
    const gameRef = doc(db, gamesCollectionPath, currentGameId);
    const gameSnap = await getDoc(gameRef);
    if (!gameSnap.exists()) return;
    const gameData = gameSnap.data();

    // Submit Word
    if (e.target.id === 'submitWordBtn') {
        const wordInput = document.getElementById('wordInput').value.trim();
        if (!wordInput) return;
        
        const me = gameData.players.find(p => p.uid === currentUserId);
        const newWords = [...gameData.words, { uid: currentUserId, name: me.name, word: wordInput, round: gameData.round }];
        const myIndex = gameData.players.findIndex(p => p.uid === currentUserId);
        const nextPlayerUid = gameData.players[(myIndex + 1) % gameData.players.length].uid;
        
        const wordsThisRound = newWords.filter(w => w.round === gameData.round);
        const newStatus = wordsThisRound.length === gameData.players.length ? 'round-end' : 'playing';

        await updateDoc(gameRef, { words: newWords, currentPlayerUid: nextPlayerUid, status: newStatus, round: newStatus === 'round-end' ? gameData.round + 1 : gameData.round });
    }

    // Handle Round End Choice
    if (e.target.id === 'continueBtn' || e.target.id === 'voteNowBtn') {
        const choice = e.target.id === 'continueBtn' ? 'continue' : 'vote';
        const newRoundChoices = { ...gameData.roundChoices, [currentUserId]: choice };
        await updateDoc(gameRef, { roundChoices: newRoundChoices });

        if (Object.keys(newRoundChoices).length === gameData.players.length) {
            const votes = Object.values(newRoundChoices).filter(c => c === 'vote').length;
            const continues = gameData.players.length - votes;
            if (votes > continues) {
                await updateDoc(gameRef, { status: 'voting' });
            } else {
                await updateDoc(gameRef, { status: 'playing', roundChoices: {}, currentPlayerUid: gameData.players[0].uid });
            }
        }
    }

    // Vote
    if (e.target.classList.contains('vote-btn')) {
        const votedForUid = e.target.dataset.voteUid;
        const newVotes = { ...(gameData.votes || {}), [currentUserId]: votedForUid };
        await updateDoc(gameRef, { votes: newVotes });

        if (Object.keys(newVotes).length === gameData.players.length) {
            const voteCounts = {};
            Object.values(newVotes).forEach(uid => { voteCounts[uid] = (voteCounts[uid] || 0) + 1; });
            let maxVotes = 0, votedOutUid = null;
            for (const uid in voteCounts) {
                if (voteCounts[uid] > maxVotes) {
                    maxVotes = voteCounts[uid];
                    votedOutUid = uid;
                }
            }
            const imposter = gameData.players.find(p => p.role === 'imposter');
            await updateDoc(gameRef, { status: 'finished', winner: votedOutUid === imposter.uid ? 'Crew' : 'Imposter', votedOutUid });
        }
    }

    // Play Again
    if (e.target.id === 'playAgainBtn') {
         const newSecretWord = getRandomWord();
         const imposterIndex = 1 + Math.floor(Math.random() * (gameData.players.length - 1));
         const newPlayers = gameData.players.map((p, i) => ({...p, role: i === imposterIndex ? 'imposter' : 'crew'}));
         await updateDoc(gameRef, {
             status: 'playing', secretWord: newSecretWord, players: newPlayers,
             words: [], votes: {}, winner: null, votedOutUid: null, round: 1, roundChoices: {},
             currentPlayerUid: gameData.players[0].uid,
         });
    }
});

// --- Authentication ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        showScreen('home');
    } else {
        try {
            const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
            if (token) {
                await signInWithCustomToken(auth, token);
            } else {
                await signInAnonymously(auth);
            }
        } catch (error) {
            console.error("Auth Error:", error);
            await signInAnonymously(auth);
        }
    }
});
