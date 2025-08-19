'use strict';

// =================== Data load ===================
async function loadPokedex(url = 'pokedex.json') {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return await res.json(); // { "1": {...}, "2": {...}, ... }
}

// =================== Helpers / indexing ===================
const NUM_TO_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function normalizeName(s) {
    return s.trim().toLowerCase().replace(/\s+/g, '-');
}
function parseGenNum(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const m = String(v).trim().match(/(\b[ivx]+\b|\b\d+\b)$/i);
    if (!m) return null;
    const tok = m[1].toUpperCase();
    const romanIdx = NUM_TO_ROMAN.indexOf(tok);
    if (romanIdx >= 0) return romanIdx + 1;
    const n = parseInt(tok, 10);
    return Number.isFinite(n) ? n : null;
}

function buildIndexes(byIdObj) {
    const list = Object.values(byIdObj).map(p => {
        const genNum = parseGenNum(p.generation);
        return {
            ...p,
            img_url: p.img_url, // from JSON
            name: String(p.name).toLowerCase(),
            canonicalName: normalizeName(p.name),
            height: Number(p.height),
            weight: Number(p.weight),
            types: Array.isArray(p.types) ? p.types.map(t => String(t).toLowerCase()) : [],
            genNum,
            generation: genNum ? `Generation ${NUM_TO_ROMAN[genNum - 1]}` : "Unknown",
        };
    });

    const byId = new Map(list.map(p => [p.id, p]));
    const byName = new Map(list.map(p => [p.canonicalName, p]));
    list.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
    return { list, byId, byName };
}

// =================== Compare logic (from old app) ===================
function within20(val, target) { const lo = target * 0.8, hi = target * 1.2; return val >= lo && val <= hi; }
function toSet(arr) { return new Set((arr || []).map(s => s.trim().toLowerCase()).filter(Boolean)); }

function compareMon(guess, answer) {
    const heightCell = within20(guess.height, answer.height) ? "Match" : (guess.height > answer.height ? "Too High" : "Too Low");
    const weightCell = within20(guess.weight, answer.weight) ? "Match" : (guess.weight > answer.weight ? "Too High" : "Too Low");

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

// grading → CSS class names
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
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// =================== Suggestions ===================
function filterByPrefix(list, queryCanonical, limit = 10) {
    const out = [];
    for (let i = 0; i < list.length && out.length < limit; i++) {
        if (list[i].canonicalName.startsWith(queryCanonical)) out.push(list[i]);
    }
    return out;
}
function renderSuggestions(boxEl, items, activeIndex) {
  boxEl.innerHTML = '';
  items.forEach((p, i) => {
    const div = document.createElement('div');

   const img = document.createElement('img');
   img.src = p.img_url;
   img.alt = p.name;
   img.loading = 'lazy';
   img.width = 48; img.height = 48;
   img.referrerPolicy = 'no-referrer';

   const label = document.createElement('span');
   label.textContent = capitalize(p.name);

   div.appendChild(img);   // sprite first
   div.appendChild(label); // name second

    div.dataset.name = p.canonicalName;
    if (i === activeIndex) div.classList.add('active');
    boxEl.appendChild(div);
  });
}

// =================== Table rendering with comparisons ===================
function appendGuessRow(tbodyEl, guess, answer, pokedex, inputEl) {
    const cmp = compareMon(guess, answer);

    const tr = document.createElement("tr");
    tr.classList.add("boxed");

    const tdName = document.createElement("td");
    tdName.textContent = capitalize(guess.name);

    const tdH = document.createElement("td");
    tdH.textContent = cmp.heightCell;
    tdH.classList.add(gradeClass(guess.height, answer.height));

    const tdW = document.createElement("td");
    tdW.textContent = cmp.weightCell;
    tdW.classList.add(gradeClass(guess.weight, answer.weight));

    const tdT = document.createElement("td");
    tdT.textContent = cmp.typesCell;
    tdT.classList.add(typesClass(cmp.typesCell));

    const tdG = document.createElement("td");
    tdG.textContent = cmp.genCell;
    tdG.classList.add(genClass(guess.genNum, answer.genNum, cmp.genCell));

    tr.append(tdName, tdH, tdW, tdT, tdG);
    tbodyEl.appendChild(tr);

    // ✅ if all cells are "Match", the player wins
    const allMatch = [cmp.heightCell, cmp.weightCell, cmp.typesCell, cmp.genCell].every(v => v === "Match");
    if (allMatch) {
        showNewGameButton(pokedex, tbodyEl, inputEl);
    }
}




function showNewGameButton(pokedex, tbodyEl, inputEl) {
    // don’t create if it already exists
    if (document.getElementById("new-game-btn")) return;

    const btn = document.createElement("button");
    btn.id = "new-game-btn";
    btn.textContent = "You Win! Start New Game";
    btn.style.display = "block";
    btn.style.margin = "20px auto";

    document.body.appendChild(btn);

    btn.addEventListener("click", () => {
        // pick a new random answer
        setNewAnswer(pokedex);

        // clear guesses + input
        tbodyEl.innerHTML = "";
        inputEl.value = "";
        inputEl.focus();

        // 🔥 remove the button so it only shows again after the next win
        btn.remove();

        console.log("Started a new game with answer:", ANSWER?.name);
    });
}




// =================== Random ANSWER (local only) ===================
let ANSWER = null;
function pickRandomAnswer(pokedex, excludeId = null) {
    if (!pokedex?.list?.length) return null;
    let idx = Math.floor(Math.random() * pokedex.list.length);
    if (excludeId != null && pokedex.list.length > 1) {
        while (pokedex.list[idx].id === excludeId) idx = Math.floor(Math.random() * pokedex.list.length);
    }
    return pokedex.list[idx];
}
function setNewAnswer(pokedex) {
    const prev = ANSWER?.id ?? null;
    ANSWER = pickRandomAnswer(pokedex, prev);
    console.log('New ANSWER:', ANSWER?.name);
}

// =================== Autocomplete wiring ===================
function attachAutocomplete(inputEl, boxEl, data, onSelect) {
    let items = [];
    let activeIndex = -1;

    function update() {
        const query = normalizeName(inputEl.value);
        if (!query) {
            items = [];
            activeIndex = -1;
            boxEl.innerHTML = '';
            return;
        }
        items = filterByPrefix(data.list, query);
        activeIndex = items.length ? 0 : -1;
        renderSuggestions(boxEl, items, activeIndex);
    }

    inputEl.addEventListener('input', update);

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            let picked = (activeIndex >= 0 && items[activeIndex]) || null;
            if (!picked) {
                const exact = data.byName.get(normalizeName(inputEl.value));
                if (exact) picked = exact;
            }
            if (picked) {
                onSelect(picked);
                boxEl.innerHTML = '';
                items = [];
                activeIndex = -1;
            }
            return;
        }

        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % items.length;
            renderSuggestions(boxEl, items, activeIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + items.length) % items.length;
            renderSuggestions(boxEl, items, activeIndex);
        } else if (e.key === 'Escape') {
            boxEl.innerHTML = '';
            items = [];
            activeIndex = -1;
        }
    });

    boxEl.addEventListener('click', (e) => {
        if (e.target.tagName === 'DIV') {
            const selected = items.find(p => p.canonicalName === e.target.dataset.name);
            if (selected) {
                onSelect(selected);
                boxEl.innerHTML = '';
                items = [];
                activeIndex = -1;
            }
        }
    });
}

// =================== Main ===================
async function main() {
    const raw = await loadPokedex('pokedex.json');
    const pokedex = buildIndexes(raw);

    setNewAnswer(pokedex);                // choose base/answer locally

    const inputEl = document.getElementById('guess-input');
    const boxEl = document.getElementById('suggestions-box');
    const tbodyEl = document.getElementById('guess-body');

    attachAutocomplete(inputEl, boxEl, pokedex, (pokemon) => {
        appendGuessRow(tbodyEl, pokemon, ANSWER, pokedex, inputEl); // pass pokedex + inputEl
        inputEl.value = '';
        inputEl.focus();
    });
    // optional button <button id="new-answer">New Answer</button>
    document.getElementById('new-answer')?.addEventListener('click', () => {
        setNewAnswer(pokedex);


    });
}

document.addEventListener('DOMContentLoaded', main);
