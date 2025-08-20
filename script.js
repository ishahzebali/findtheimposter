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

// --- Helper: Shuffle Array ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}


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
        playerDiv.className = 'player-list-item'; // Using custom class
        playerDiv.innerHTML = `<p>${player.name} ${player.isHost ? '(Host)' : ''}</p>`;
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
    
    // Use the turn order stored in the game data
    const orderedPlayers = gameData.turnOrder.map(uid => gameData.players.find(p => p.uid === uid));

    let playersHTML = orderedPlayers.map(player => {
        const wordsForPlayer = gameData.words.filter(w => w.uid === player.uid).map(w => w.word).join(', ');
        const isCurrentPlayer = gameData.currentPlayerUid === player.uid;
        const canVote = player.uid !== currentUserId && gameData.status === 'voting' && !(gameData.votes && gameData.votes[currentUserId]);
        
        return `
            <div class="player-card ${isCurrentPlayer && gameData.status === 'playing' ? 'current-player' : ''}">
                <p class="name">${player.name}</p>
                <p class="word">${wordsForPlayer || '...'}</p>
                ${canVote ? `<button data-vote-uid="${player.uid}" class="btn blue vote-btn">Vote</button>` : ''}
            </div>
        `;
    }).join('');

    let turnHTML = '';
    if (gameData.status === 'playing' && isMyTurn) {
        turnHTML = `
            <div class="game-input-area">
                <h3>Round ${gameData.round}: It's your turn!</h3>
                <div style="display: flex; gap: 10px;">
                    <input id="wordInput" type="text" placeholder="Enter your word...">
                    <button id="submitWordBtn" class="btn blue">Submit</button>
                </div>
            </div>
        `;
    } else if (gameData.status === 'voting') {
         turnHTML = `
            <div class="game-input-area">
                <h3>Vote for the Imposter!</h3>
                <p>${(gameData.votes && gameData.votes[currentUserId]) ? 'Waiting for others...' : 'Click vote on a player card.'}</p>
            </div>
         `;
    }

    gameContent.innerHTML = `
        <div class="text-center mb-6">
            <h2 class="subtitle" style="font-size: 1.2rem;">Your Word Is:</h2>
            <p style="font-size: 2.5rem; color: #e94560; text-shadow: none;">${me.role === 'imposter' ? '???' : gameData.secretWord}</p>
            <p style="font-size: 1rem; color: #fff;">You are: <span class="${me.role === 'imposter' ? 'role-tag imposter' : 'role-tag crew'}">${me.role.toUpperCase()}</span></p>
        </div>
        <div class="player-cards-grid">
            ${playersHTML}
        </div>
        ${turnHTML}
    `;
}

function renderRoundEnd(gameData) {
    const gameContent = document.getElementById('game-content');
    const myChoice = gameData.roundChoices ? gameData.roundChoices[currentUserId] : null;

    const orderedPlayers = gameData.turnOrder.map(uid => gameData.players.find(p => p.uid === uid));

    let playersHTML = orderedPlayers.map(player => {
        const wordsForPlayer = gameData.words.filter(w => w.uid === player.uid).map(w => w.word).join(', ');
        return `
            <div class="player-card">
                <p class="name">${player.name}</p>
                <p class="word">${wordsForPlayer || '...'}</p>
            </div>
        `;
    }).join('');

    let choiceHTML = '';
    if (myChoice) {
        choiceHTML = `<p class="subtitle" style="font-size: 1rem;">You chose to ${myChoice}. Waiting for other players...</p>`;
    } else {
        choiceHTML = `
            <div style="display: flex; gap: 15px; margin-top: 20px;">
                <button id="continueBtn" class="btn green">Continue</button>
                <button id="voteNowBtn" class="btn red">Vote Now</button>
            </div>
        `;
    }

    gameContent.innerHTML = `
        <div class="game-input-area">
            <h3>End of Round ${gameData.round - 1}</h3>
            <div class="player-cards-grid">${playersHTML}</div>
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
            <div class="player-card">
                <div style="display:flex; justify-content: space-between; align-items: center;">
                    <p class="name">${player.name}</p>
                    <span class="role-tag ${player.role === 'imposter' ? 'imposter' : 'crew'}">${player.role.toUpperCase()}</span>
                </div>
                <p class="word">${wordsForPlayer}</p>
            </div>
        `;
    }).join('');

    gameContent.innerHTML = `
        <div class="game-input-area">
            <h2 style="font-size: 2rem; color: #333;">${gameData.winner} Wins!</h2>
            <p class="subtitle">The secret word was: <strong>${gameData.secretWord}</strong></p>
            <p class="subtitle">The imposter was: <strong>${imposter.name}</strong></p>
            <p class="subtitle">You voted out: <strong>${votedOutPlayer?.name || 'Nobody'}</strong></p>
            <div class="player-cards-grid">${playersHTML}</div>
            ${me.isHost ? `<button id="playAgainBtn" class="btn green">Play Again</button>` : '<p class="subtitle">Waiting for host to start a new game...</p>'}
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
        turnOrder: [],
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
        
        // --- CHANGE: Shuffle players for random turn order ---
        const shuffledPlayers = shuffleArray([...gameData.players]);
        const turnOrder = shuffledPlayers.map(p => p.uid);

        // --- CHANGE: Ensure imposter is not the first player in the random order ---
        const firstPlayerUid = turnOrder[0];
        const eligibleImposters = shuffledPlayers.filter(p => p.uid !== firstPlayerUid);
        const imposter = eligibleImposters[Math.floor(Math.random() * eligibleImposters.length)];
        
        const playersWithRoles = gameData.players.map(p => ({
            ...p,
            role: p.uid === imposter.uid ? 'imposter' : 'crew'
        }));

        await updateDoc(gameRef, {
            status: 'playing',
            players: playersWithRoles,
            secretWord: secretWord,
            currentPlayerUid: firstPlayerUid, // Start with the first random player
            turnOrder: turnOrder, // Save the random turn order
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
        
        const myIndexInTurnOrder = gameData.turnOrder.indexOf(currentUserId);
        const nextPlayerUid = gameData.turnOrder[(myIndexInTurnOrder + 1) % gameData.turnOrder.length];
        
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
                // Start next round with a new random turn order
                const newTurnOrder = shuffleArray([...gameData.turnOrder]);
                await updateDoc(gameRef, { status: 'playing', roundChoices: {}, currentPlayerUid: newTurnOrder[0], turnOrder: newTurnOrder });
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
         const shuffledPlayers = shuffleArray([...gameData.players]);
         const newTurnOrder = shuffledPlayers.map(p => p.uid);
         const firstPlayerUid = newTurnOrder[0];
         const eligibleImposters = shuffledPlayers.filter(p => p.uid !== firstPlayerUid);
         const imposter = eligibleImposters[Math.floor(Math.random() * eligibleImposters.length)];
         const newPlayers = gameData.players.map(p => ({...p, role: p.uid === imposter.uid ? 'imposter' : 'crew'}));
         
         await updateDoc(gameRef, {
             status: 'playing', secretWord: newSecretWord, players: newPlayers,
             words: [], votes: {}, winner: null, votedOutUid: null, round: 1, roundChoices: {},
             currentPlayerUid: firstPlayerUid, turnOrder: newTurnOrder,
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
