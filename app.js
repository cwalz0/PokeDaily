// =================== config/constants ===================
const INPUT_ID = "guess-input";
const TBODY_ID = "guess-body";

const GEN_NAME_TO_NUM = {
    "generation-i": 1, "generation-ii": 2, "generation-iii": 3, "generation-iv": 4,
    "generation-v": 5, "generation-vi": 6, "generation-vii": 7, "generation-viii": 8, "generation-ix": 9
};
const NUM_TO_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// =================== tiny cache (localStorage) ===================
const cache = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
async function getJson(url) {
    const hit = cache.get(url);
    if (hit) return hit;
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`HTTP ${res.status} for ${url}${text ? " — " + text.slice(0, 120) : ""}`);
        err.status = res.status;
        throw err;
    }
    const data = await res.json();
    cache.set(url, data);
    return data;
}

// =================== answer + guesses persistence ===================
function saveAnswer(answer) { localStorage.setItem("answer_mon", JSON.stringify(answer)); }
function loadAnswer() { try { return JSON.parse(localStorage.getItem("answer_mon") || "null"); } catch { return null; } }

function saveGuesses(guesses) { localStorage.setItem("guesses", JSON.stringify(guesses)); }
function loadGuesses() { try { return JSON.parse(localStorage.getItem("guesses") || "[]"); } catch { return []; } }

function saveBestScore(v) { localStorage.setItem("best_score", JSON.stringify(v)); }
function loadBestScore() {
    try { return JSON.parse(localStorage.getItem("best_score") || "null"); }
    catch { return null; }
}

let CURRENT_SCORE = 0;           // guesses in current game
let BEST_SCORE = loadBestScore(); // lowest across games (null if none yet)

function updateScoreUI() {
    const cur = document.getElementById("score-current");
    const best = document.getElementById("score-best");
    if (cur) cur.textContent = String(CURRENT_SCORE);
    if (best) best.textContent = (BEST_SCORE == null ? "—" : String(BEST_SCORE));
}

// =================== API wrappers ===================
async function fetchPokemonById(id) {
    const mon = await getJson(`https://pokeapi.co/api/v2/pokemon/${id}`);
    const species = await getJson(mon.species.url);
    const genKey = species.generation.name;
    const genNum = GEN_NAME_TO_NUM[genKey] ?? null;
    return {
        name: mon.name,
        height: parseFloat((mon.height / 10).toFixed(1)), // m
        weight: parseFloat((mon.weight / 10).toFixed(1)), // kg
        types: mon.types.map(t => t.type.name),
        generation: genNum ? `Generation ${NUM_TO_ROMAN[genNum - 1]}` : "Unknown",
        genNum
    };
}
async function fetchPokemonByName(name) {
    const mon = await getJson(`https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`);
    const species = await getJson(mon.species.url);
    const genKey = species.generation.name;
    const genNum = GEN_NAME_TO_NUM[genKey] ?? null;
    return {
        name: mon.name,
        height: parseFloat((mon.height / 10).toFixed(1)),
        weight: parseFloat((mon.weight / 10).toFixed(1)),
        types: mon.types.map(t => t.type.name),
        generation: genNum ? `Generation ${NUM_TO_ROMAN[genNum - 1]}` : "Unknown",
        genNum
    };
}

// =================== answer selection ===================
let ANSWER = null;
let GUESSES = loadGuesses(); // [{ guess, cmp }]

function randIntInclusive(min, max) { min = Math.ceil(min); max = Math.floor(max); return Math.floor(Math.random() * (max - min + 1)) + min; }
async function setRandomAnswer({ min = 1, max = 1025, tries = 12 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        const id = randIntInclusive(min, max);
        try {
            const ans = await fetchPokemonById(id);
            ANSWER = ans; saveAnswer(ans);
            console.log(`Answer set to #${id}: ${ans.name}`);
            return;
        } catch (e) {
            lastErr = e;
            if (e.status === 404 || e.status === 429 || (e.status >= 500 && e.status < 600)) {
                console.warn(`Retry ${i + 1}/${tries} for id ${id} ->`, e.message);
                continue;
            }
            throw e;
        }
    }
    throw new Error(`Failed to set random answer after ${tries} tries. Last error: ${lastErr?.message}`);
}

// =================== compare logic ===================
function within20(val, target) { const lo = target * 0.8, hi = target * 1.2; return val >= lo && val <= hi; }
function toSet(arr) { return new Set((arr || []).map(s => s.trim().toLowerCase()).filter(Boolean)); }

function compareMon(guess, answer) {
    let heightCell = within20(guess.height, answer.height) ? "Match" : (guess.height > answer.height ? "∧" : "∨");
    let weightCell = within20(guess.weight, answer.weight) ? "Match" : (guess.weight > answer.weight ? "∧" : "∨");

    const gTypes = toSet(guess.types), aTypes = toSet(answer.types);
    let typesCell = "No Match";
    if (gTypes.size && aTypes.size) {
        const inter = [...gTypes].some(t => aTypes.has(t));
        const equal = gTypes.size === aTypes.size && [...gTypes].every(t => aTypes.has(t));
        typesCell = equal ? "Match" : (inter ? "Partial Match" : "No Match");
    }

    let genCell = "Unknown";
    if (guess.genNum && answer.genNum) {
        genCell = (guess.genNum === answer.genNum) ? "Match" : (guess.genNum < answer.genNum ? "Too early" : "Too late");
    }
    return { heightCell, weightCell, typesCell, genCell };
}

// ==== grading → CSS classes ====
function gradeClass(val, target) {
    if (!Number.isFinite(val) || !Number.isFinite(target) || target <= 0) return "far";
    const r = Math.abs(val - target) / target;
    if (r <= 0.20) return "ok";
    if (r <= 0.35) return "close";
    if (r <= 0.50) return "mid";
    return "far";
}
function typesClass(text) { return text === "Match" ? "ok" : (text === "Partial Match" ? "close" : "far"); }
function genClass(guessGenNum, answerGenNum, text) {
    if (text === "Match") return "ok";
    if (!guessGenNum || !answerGenNum) return "far";
    const d = Math.abs(guessGenNum - answerGenNum);
    if (d === 1) return "close";
    if (d === 2) return "mid";
    return "far";
}

// =================== rendering ===================
function appendRow(guess, cmp, { skipSave = false } = {}) {
  const tbody = document.getElementById(TBODY_ID);
  const tr = document.createElement("tr");
  tr.classList.add("boxed");

  const tdName = document.createElement("td");
  tdName.textContent = capitalize(guess.name);

  const tdH = document.createElement("td");
  tdH.textContent = cmp.heightCell;
  tdH.classList.add(gradeClass(guess.height, ANSWER.height));

  const tdW = document.createElement("td");
  tdW.textContent = cmp.weightCell;
  tdW.classList.add(gradeClass(guess.weight, ANSWER.weight));

  const tdT = document.createElement("td");
  tdT.textContent = cmp.typesCell;
  tdT.classList.add(typesClass(cmp.typesCell));

  const tdG = document.createElement("td");
  tdG.textContent = cmp.genCell;
  tdG.classList.add(genClass(guess.genNum, ANSWER.genNum, cmp.genCell));

  tr.append(tdName, tdH, tdW, tdT, tdG);

  // ⬇️ append ONCE
  tbody.appendChild(tr);

  // persist this new guess (unless we're restoring)
  if (!skipSave) {
    GUESSES.push({ guess, cmp });
    saveGuesses(GUESSES);
    // bump score for a new guess
    CURRENT_SCORE += 1;
    updateScoreUI();
  }

  markLatestRow();

  const allMatch = [cmp.heightCell, cmp.weightCell, cmp.typesCell, cmp.genCell].every(v => v === "Match");
  if (allMatch) {
    // update best (lowest) score if this run is better
    if (BEST_SCORE == null || CURRENT_SCORE < BEST_SCORE) {
      BEST_SCORE = CURRENT_SCORE;
      saveBestScore(BEST_SCORE);
      updateScoreUI();
    }
    showNewGameButton(); // ⬅️ only once
  }
}
function renderAllGuesses() {
  const tbody = document.getElementById(TBODY_ID);
  tbody.innerHTML = "";
  GUESSES.forEach(({ guess, cmp }) => appendRow(guess, cmp, { skipSave: true }));

  // after restore, score = number of rows
  CURRENT_SCORE = GUESSES.length;
  updateScoreUI();
}

function markLatestRow() {
    const rows = Array.from(document.querySelectorAll(`#${TBODY_ID} tr`));
    rows.forEach(r => r.classList.remove("boxed_latest", "boxed_oldest"));
    if (!rows.length) return;
    rows.slice(0, -1).forEach(r => r.classList.add("boxed_oldest"));
    rows[rows.length - 1].classList.add("boxed_latest");
}

function showNewGameButton() {
    if (document.getElementById("new-game-btn")) return;
    const btn = document.createElement("button");
    btn.id = "new-game-btn";
    btn.textContent = "You Win! Start New Game";
    btn.style.display = "block";
    btn.style.margin = "20px auto";
    document.body.appendChild(btn);
    btn.addEventListener("click", async () => {
        try {
            await setRandomAnswer();
            document.getElementById(TBODY_ID).innerHTML = "";
            GUESSES = [];
            saveGuesses(GUESSES);
            updateScoreUI();
            CURRENT_SCORE = 0;
            btn.remove();
        } catch (e) {
            alert("Could not pick a new answer.\n\n" + e.message);
        }
    });
}

// =================== input wiring ===================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const saved = loadAnswer();
        if (saved) { ANSWER = saved; console.log("Loaded saved answer:", ANSWER.name); }
        else { await setRandomAnswer(); }
    } catch (e) {
        console.error(e);
        alert("Could not set the target Pokémon.\n\n" + e.message);
    }

    // restore table on refresh
    renderAllGuesses();

    const input = document.getElementById(INPUT_ID);
    input.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        const q = (input.value || "").trim();
        if (!q) return;
        try {
            const guess = await fetchPokemonByName(q);
            const cmp = compareMon(guess, ANSWER);
            appendRow(guess, cmp);
            input.value = "";
        } catch (err) {
            console.error(err);
            alert(err.message || "Failed to fetch Pokémon.");
        }
    });

    document.getElementById("new-answer")?.addEventListener("click", async () => {
        try {
            await setRandomAnswer();
            document.getElementById(TBODY_ID).innerHTML = "";
            GUESSES = [];
            saveGuesses(GUESSES);
            document.getElementById("new-game-btn")?.remove();
        } catch (e) {
            alert("Could not pick a new answer.\n\n" + e.message);
        }
    });
});

// =================== helpers ===================
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
