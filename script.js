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
let localPlayerList = [];
let audioStarted = false;
let countdownInterval = null;
let isRevealingRole = false;

// --- Sound Effects ---
const winSound = new Tone.Synth({ oscillator: { type: "sine" } }).toDestination();
const loseSound = new Tone.Synth({ oscillator: { type: "triangle" } }).toDestination();

// --- UI Elements ---
const screens = {
    loading: document.getElementById('loading-screen'),
    home: document.getElementById('home-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    'role-reveal': document.getElementById('role-reveal-screen'),
};

// --- Word List ---
const wordList = [
    "Apple", "Banana", "Carrot", "Internet", "Java", "Kiwi", "Sun", "Moon", "Dog", "Cat", "Car", "Bicycle", "River", "Mountain",
    "Ocean", "Desert", "Forest", "Rain", "Snow", "Cloud", "Star", "Pizza", "Burger", "Sushi", "Coffee", "Tea", "Book", "Movie",
    "Music", "Art", "Science", "History", "Math", "Language", "Computer", "Phone", "Television", "Guitar", "Piano", "Drums",
    "Soccer", "Basketball", "Baseball", "Tennis", "Swimming", "Running", "Doctor", "Teacher", "Artist", "Engineer", "Chef"
];
const getRandomWord = (usedWords = []) => {
    const availableWords = wordList.filter(word => !usedWords.includes(word));
    if (availableWords.length === 0) return wordList[Math.floor(Math.random() * wordList.length)]; // Fallback
    return availableWords[Math.floor(Math.random() * availableWords.length)];
};

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
    document.querySelectorAll('.confetti').forEach(c => c.remove());
}

// --- Sound & Celebration ---
async function startAudio() {
    if (!audioStarted) {
        await Tone.start();
        audioStarted = true;
        console.log('Audio context started!');
    }
}

async function triggerCelebration(winner, me) {
    await startAudio();

    if (me.role === 'imposter' && winner === 'Imposter' || me.role === 'crew' && winner === 'Crew') {
        winSound.triggerAttackRelease("C5", "8n", Tone.now());
        winSound.triggerAttackRelease("E5", "8n", Tone.now() + 0.2);
        winSound.triggerAttackRelease("G5", "8n", Tone.now() + 0.4);
    } else {
        loseSound.triggerAttackRelease("G2", "4n", Tone.now());
    }

    const colors = winner === 'Crew' ? ['#50c878', '#a3d9a5', '#ffffff'] : ['#e94560', '#f08080', '#ffffff'];
    for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = `${Math.random() * 100}vw`;
        confetti.style.animationDelay = `${Math.random() * 5}s`;
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        document.body.appendChild(confetti);
    }
}

// --- Render Functions ---
function renderLobby(gameData) {
    document.getElementById('lobby-content').classList.remove('hidden');
    document.getElementById('countdown-container').classList.add('hidden');
    document.getElementById('lobbyGameId').textContent = gameData.gameId;
    document.getElementById('gameScreenId').textContent = gameData.gameId;
    document.getElementById('playerCount').textContent = gameData.players.length;
    
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    gameData.players.forEach(player => {
        const playerDiv = document.createElement('div');
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

function renderStarting(gameData) {
    document.getElementById('lobby-content').classList.add('hidden');
    document.getElementById('countdown-container').classList.remove('hidden');
    const timerEl = document.getElementById('countdown-timer');

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        const remaining = Math.ceil((gameData.startTime.toDate() - new Date()) / 1000);
        if (timerEl) {
            timerEl.textContent = remaining > 0 ? remaining : 0;
        }
        if (remaining <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }, 1000);
}

async function renderRoleReveal(gameData) {
    isRevealingRole = true;
    const me = gameData.players.find(p => p.uid === currentUserId);
    const roleEl = document.getElementById('reveal-role');
    const wordEl = document.getElementById('reveal-word');

    roleEl.textContent = me.role.toUpperCase();
    roleEl.className = `reveal-role ${me.role}`;
    wordEl.textContent = me.role === 'imposter' ? '???' : gameData.secretWord;

    showScreen('role-reveal');
    
    const gameRef = doc(db, gamesCollectionPath, currentGameId);
    await updateDoc(gameRef, { [`revealedRoles.${currentUserId}`]: true });

    setTimeout(() => {
        if (currentGameId) {
            renderGame(gameData);
            showScreen('game');
            isRevealingRole = false;
        }
    }, 4000);
}


function renderGame(gameData) {
    const me = gameData.players.find(p => p.uid === currentUserId);
    const isMyTurn = gameData.currentPlayerUid === currentUserId;
    const gameContent = document.getElementById('game-content');
    
    const orderedPlayers = gameData.turnOrder.map(uid => gameData.players.find(p => p.uid === uid));

    let playersHTML = orderedPlayers.map(player => {
        const wordsForPlayer = gameData.words.filter(w => w.uid === player.uid).map(w => w.word).join(', ');
        const isCurrentPlayer = gameData.currentPlayerUid === player.uid;
        const hasVoted = gameData.votes && gameData.votes[player.uid];
        const canVote = player.uid !== currentUserId && !player.disconnected && gameData.status === 'voting' && !(gameData.votes && gameData.votes[currentUserId]);
        
        return `
            <div class="player-card ${isCurrentPlayer && gameData.status === 'playing' ? 'current-player' : ''} ${player.disconnected ? 'disconnected' : ''}">
                <p class="name">${player.name} ${player.disconnected ? '(Left)' : ''}</p>
                <p class="word">${wordsForPlayer || '...'}</p>
                ${hasVoted && gameData.status === 'voting' ? '<div class="voted-indicator">Voted ✓</div>' : ''}
                ${canVote ? `<button data-vote-uid="${player.uid}" class="btn blue vote-btn">Vote</button>` : ''}
            </div>
        `;
    }).join('');

    let turnHTML = '';
    if (gameData.status === 'playing' && isMyTurn) {
        turnHTML = `
            <div class="game-input-area">
                <h3>Round ${gameData.round}: It's your turn!</h3>
                <div class="input-group">
                    <input id="wordInput" type="text" placeholder="Enter your word...">
                    <button id="submitWordBtn" class="btn blue">Submit</button>
                </div>
            </div>
        `;
    } else if (gameData.status === 'voting') {
         turnHTML = `
            <div class="game-input-area">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3>Vote for the Imposter!</h3>
                    <div id="vote-timer">30</div>
                </div>
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
            <div class="player-card ${player.disconnected ? 'disconnected' : ''}">
                <p class="name">${player.name} ${player.disconnected ? '(Left)' : ''}</p>
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
            <h3>End of Round ${gameData.round}</h3>
            <div class="player-cards-grid">${playersHTML}</div>
            ${choiceHTML}
        </div>
    `;
}

function renderFinished(gameData) {
    const imposter = gameData.players.find(p => p.role === 'imposter');
    const me = gameData.players.find(p => p.uid === currentUserId);
    triggerCelebration(gameData.winner, me);
    const gameContent = document.getElementById('game-content');

    let playersHTML = gameData.players.map(player => {
        const wordsForPlayer = gameData.words.filter(w => w.uid === player.uid).map(w => w.word).join(', ');
        const votedForUid = gameData.votes[player.uid];
        const votedForPlayer = votedForUid ? gameData.players.find(p => p.uid === votedForUid) : null;
        const voteText = votedForPlayer ? `Voted for ${votedForPlayer.name}` : 'No vote';

        return `
            <div class="player-card ${player.disconnected ? 'disconnected' : ''}">
                <div style="display:flex; justify-content: space-between; align-items: center;">
                    <p class="name">${player.name}</p>
                    <span class="role-tag ${player.role === 'imposter' ? 'imposter' : 'crew'}">${player.role.toUpperCase()}</span>
                </div>
                <p class="word">${wordsForPlayer}</p>
                <p style="font-size: 0.8rem; color: #888; margin-top: 10px;"><em>${voteText}</em></p>
            </div>
        `;
    }).join('');

    gameContent.innerHTML = `
        <div class="game-input-area">
            <h2 style="font-size: 2rem; color: #333;">${gameData.winner} Wins!</h2>
            <p class="subtitle" style="color: #333;">${gameData.outcomeMessage}</p>
            <p class="subtitle" style="color: #333;">The secret word was: <strong>${gameData.secretWord}</strong></p>
            <p class="subtitle" style="color: #333;">The imposter was: <strong>${imposter.name}</strong></p>
            <div class="player-cards-grid">${playersHTML}</div>
            ${me.isHost ? `<button id="playAgainBtn" class="btn green">Play Again</button>` : '<p class="subtitle">Waiting for host to start a new game...</p>'}
        </div>
    `;
}

// --- Game Logic Handlers ---
async function handleCreateGame() {
    await startAudio();
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
        usedWords: [],
        createdAt: new Date(),
    };

    await setDoc(doc(db, gamesCollectionPath, newGameId), newGameData);
    joinGame(newGameId);
}

async function handleJoinGame() {
    await startAudio();
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

async function tallyVotes(gameData) {
    const gameRef = doc(db, gamesCollectionPath, currentGameId);
    const activePlayers = gameData.players.filter(p => !p.disconnected);
    const voteCounts = {};
    Object.values(gameData.votes).forEach(uid => { voteCounts[uid] = (voteCounts[uid] || 0) + 1; });

    let maxVotes = 0;
    let candidates = [];
    for (const uid in voteCounts) {
        if (voteCounts[uid] > maxVotes) {
            maxVotes = voteCounts[uid];
            candidates = [uid];
        } else if (voteCounts[uid] === maxVotes) {
            candidates.push(uid);
        }
    }

    const imposter = gameData.players.find(p => p.role === 'imposter');
    let winner, votedOutUid = null, outcomeMessage = '';

    if (candidates.length > 1 || candidates.length === 0) {
        winner = 'Imposter';
        votedOutUid = null;
        outcomeMessage = "It's a tie! The crew couldn't decide.";
    } else {
        votedOutUid = candidates[0];
        winner = votedOutUid === imposter.uid ? 'Crew' : 'Imposter';
        const votedOutPlayer = gameData.players.find(p => p.uid === votedOutUid);
        outcomeMessage = `The crew voted out ${votedOutPlayer?.name || 'Nobody'}.`;
    }

    await updateDoc(gameRef, { 
        status: 'finished', 
        winner: winner, 
        votedOutUid: votedOutUid,
        outcomeMessage: outcomeMessage 
    });
}

function joinGame(gameId) {
    currentGameId = gameId;
    localStorage.setItem('pretenderGameId', gameId);
    if (gameUnsubscribe) gameUnsubscribe();

    gameUnsubscribe = onSnapshot(doc(db, gamesCollectionPath, gameId), async (doc) => {
        if (doc.exists()) {
            const gameData = doc.data();
            const me = gameData.players.find(p => p.uid === currentUserId);
            const activePlayers = gameData.players.filter(p => !p.disconnected);

            if (gameData.status !== 'starting' && countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }

            if (me?.isHost && localPlayerList.length > gameData.players.length) {
                const disconnectedPlayer = localPlayerList.find(p => !gameData.players.some(gp => gp.uid === p.uid));
                if (disconnectedPlayer) {
                    const playerRef = gameData.players.find(p => p.uid === disconnectedPlayer.uid);
                    if (playerRef && !playerRef.disconnected) {
                        playerRef.disconnected = true;
                        await updateDoc(doc(db, gamesCollectionPath, gameId), { players: gameData.players });
                    }
                }
            }
            localPlayerList = gameData.players;

            if (gameData.status === 'voting' && Object.keys(gameData.votes).length === activePlayers.length) {
                if (me?.isHost) {
                    await tallyVotes(gameData);
                }
                return;
            }

            if (isRevealingRole) return;

            switch (gameData.status) {
                case 'lobby': renderLobby(gameData); showScreen('lobby'); break;
                case 'starting': renderStarting(gameData); showScreen('lobby'); break;
                case 'playing': 
                    if (!gameData.revealedRoles || !gameData.revealedRoles[currentUserId]) {
                        renderRoleReveal(gameData);
                    } else {
                        renderGame(gameData);
                        showScreen('game');
                    }
                    break;
                case 'voting': renderGame(gameData); showScreen('game'); break;
                case 'round-end': renderRoundEnd(gameData); showScreen('game'); break;
                case 'finished': renderFinished(gameData); showScreen('game'); break;
            }
        } else {
            alert("Game not found or has been deleted.");
            leaveGame();
        }
    });
}

function leaveGame() {
    if (gameUnsubscribe) gameUnsubscribe();
    if (countdownInterval) clearInterval(countdownInterval);
    localStorage.removeItem('pretenderGameId');
    currentGameId = null;
    gameUnsubscribe = null;
    showScreen('home');
}

async function advanceTurn(gameData) {
    const gameRef = doc(db, gamesCollectionPath, currentGameId);
    const activePlayers = gameData.players.filter(p => !p.disconnected);
    
    const myIndexInTurnOrder = gameData.turnOrder.indexOf(gameData.currentPlayerUid);
    const wordsThisRound = gameData.words.filter(w => w.round === gameData.round);

    if (wordsThisRound.length === activePlayers.length) {
        await updateDoc(gameRef, { status: 'round-end' });
    } else {
        let nextPlayerIndex = (myIndexInTurnOrder + 1) % gameData.turnOrder.length;
        let nextPlayerUid = gameData.turnOrder[nextPlayerIndex];
        let nextPlayer = gameData.players.find(p => p.uid === nextPlayerUid);

        while(nextPlayer.disconnected) {
            nextPlayerIndex = (nextPlayerIndex + 1) % gameData.turnOrder.length;
            nextPlayerUid = gameData.turnOrder[nextPlayerIndex];
            nextPlayer = gameData.players.find(p => p.uid === nextPlayerUid);
        }
        
        await updateDoc(gameRef, { 
            currentPlayerUid: nextPlayerUid, 
        });
    }
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
        await updateDoc(gameRef, {
            status: 'starting',
            startTime: new Date(Date.now() + 10000)
        });

        setTimeout(async () => {
            const gameSnap = await getDoc(gameRef);
            if (gameSnap.exists() && gameSnap.data().status === 'starting') {
                const gameData = gameSnap.data();
                const secretWord = getRandomWord(gameData.usedWords);
                
                const shuffledPlayers = shuffleArray([...gameData.players]);
                const turnOrder = shuffledPlayers.map(p => p.uid);

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
                    currentPlayerUid: firstPlayerUid, 
                    turnOrder: turnOrder,
                    round: 1,
                    roundChoices: {},
                    words: [],
                    votes: {},
                    revealedRoles: {},
                    usedWords: [...(gameData.usedWords || []), secretWord]
                });
            }
        }, 10000);
    }
});

document.getElementById('game-screen').addEventListener('click', async (e) => {
    const gameRef = doc(db, gamesCollectionPath, currentGameId);
    const gameSnap = await getDoc(gameRef);
    if (!gameSnap.exists()) return;
    const gameData = gameSnap.data();
    const activePlayers = gameData.players.filter(p => !p.disconnected);

    // Submit Word
    if (e.target.id === 'submitWordBtn') {
        const wordInput = document.getElementById('wordInput').value.trim();
        if (!wordInput) return;
        
        const me = gameData.players.find(p => p.uid === currentUserId);
        const newWords = [...gameData.words, { uid: currentUserId, name: me.name, word: wordInput, round: gameData.round }];
        
        await updateDoc(gameRef, { words: newWords });
        await advanceTurn({ ...gameData, words: newWords });
    }

    // Handle Round End Choice
    if (e.target.id === 'continueBtn' || e.target.id === 'voteNowBtn') {
        const choice = e.target.id === 'continueBtn' ? 'continue' : 'vote';
        const newRoundChoices = { ...gameData.roundChoices, [currentUserId]: choice };
        await updateDoc(gameRef, { roundChoices: newRoundChoices });

        if (Object.keys(newRoundChoices).length === activePlayers.length) {
            const votes = Object.values(newRoundChoices).filter(c => c === 'vote').length;
            const continues = activePlayers.length - votes;
            if (votes > continues) {
                await updateDoc(gameRef, { status: 'voting' });
            } else {
                const newTurnOrder = shuffleArray([...gameData.turnOrder]);
                await updateDoc(gameRef, { 
                    status: 'playing', 
                    round: gameData.round + 1,
                    roundChoices: {}, 
                    currentPlayerUid: newTurnOrder[0], 
                    turnOrder: newTurnOrder, 
                });
            }
        }
    }

    // Vote
    if (e.target.classList.contains('vote-btn')) {
        const votedForUid = e.target.dataset.voteUid;
        await updateDoc(gameRef, {
            [`votes.${currentUserId}`]: votedForUid
        });
    }

    // Play Again
    if (e.target.id === 'playAgainBtn') {
         const secretWord = getRandomWord(gameData.usedWords);
         const shuffledPlayers = shuffleArray([...gameData.players]);
         const newTurnOrder = shuffledPlayers.map(p => p.uid);
         const firstPlayerUid = newTurnOrder[0];
         const eligibleImposters = shuffledPlayers.filter(p => p.uid !== firstPlayerUid);
         const imposter = eligibleImposters[Math.floor(Math.random() * eligibleImposters.length)];
         const newPlayers = gameData.players.map(p => ({...p, role: p.uid === imposter.uid ? 'imposter' : 'crew', disconnected: false}));
         
         await updateDoc(gameRef, {
             status: 'playing', 
             secretWord: secretWord, 
             players: newPlayers,
             words: [], 
             votes: {}, 
             winner: null, 
             votedOutUid: null, 
             round: 1, 
             roundChoices: {},
             currentPlayerUid: firstPlayerUid, 
             turnOrder: newTurnOrder, 
             revealedRoles: {},
             usedWords: [...(gameData.usedWords || []), secretWord]
         });
    }
});

// --- Authentication ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        const savedGameId = localStorage.getItem('pretenderGameId');
        if (savedGameId) {
            joinGame(savedGameId);
        } else {
            showScreen('home');
        }
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
