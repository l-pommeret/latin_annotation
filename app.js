/*
 * Evalatin 2026 – Blind Evaluation Interface
 * Version 2.1.0 – Fully blind output + auto-save
 */

const PRACTICE_COUNT = 50;

let evalData = {};
let udRules = {};

let currentBenchIndex = parseInt(localStorage.getItem('eval2_bench_idx')) || 0;
let currentSentenceIndex = parseInt(localStorage.getItem('eval2_sent_idx')) || 0;
let currentDisIndex = parseInt(localStorage.getItem('eval2_dis_idx')) || 0;
let benchmarks = [];
let responses = JSON.parse(localStorage.getItem('eval2_responses')) || [];
let practiceResponses = JSON.parse(localStorage.getItem('eval2_practice_responses')) || [];
let practiceCompleted = localStorage.getItem('eval2_practice_done') === 'true';

let flatItems = [];

const app = document.getElementById('app');
const template = document.getElementById('eval-template');
const practiceTemplate = document.getElementById('practice-transition-template');

// Deterministic A/B assignment using a hash — same for all annotators
function getAbAssignment(flatIdx) {
    // Knuth multiplicative hash — deterministic, looks random
    return (((flatIdx * 2654435761) >>> 0) % 2) === 0;
}

async function init() {
    try {
        const [dataRes, rulesRes] = await Promise.all([
            fetch('data/eval_gold_vs_ia.json'),
            fetch('data/rules.json')
        ]);
        evalData = await dataRes.json();
        udRules = await rulesRes.json();
        benchmarks = Object.keys(evalData).filter(b => evalData[b].length > 0);

        if (benchmarks.length === 0) {
            app.innerHTML = '<div class="loading">Aucune donnée trouvée.</div>';
            return;
        }

        buildFlatList();

        const savedFlatIdx = parseInt(localStorage.getItem('eval2_flat_idx')) || 0;
        if (savedFlatIdx < flatItems.length) {
            setPositionFromFlatIndex(savedFlatIdx);
        }

        if (!practiceCompleted && getFlatIndex() >= PRACTICE_COUNT) {
            showPracticeTransition();
        } else if (getFlatIndex() >= flatItems.length) {
            showResults();
        } else {
            renderCurrent();
        }
    } catch (err) {
        console.error(err);
        app.innerHTML = `<div class="loading">Erreur lors du chargement: ${err.message}</div>`;
    }
}

function buildFlatList() {
    flatItems = [];
    for (const bench of benchmarks) {
        for (let si = 0; si < evalData[bench].length; si++) {
            const sentence = evalData[bench][si];
            for (let di = 0; di < sentence.disagreements.length; di++) {
                flatItems.push({ bench, si, di });
            }
        }
    }
}

function getFlatIndex() {
    let idx = 0;
    for (let bi = 0; bi < benchmarks.length; bi++) {
        const bench = benchmarks[bi];
        if (bi < currentBenchIndex) {
            idx += evalData[bench].reduce((acc, s) => acc + s.disagreements.length, 0);
        } else if (bi === currentBenchIndex) {
            for (let si = 0; si < currentSentenceIndex; si++) {
                idx += evalData[bench][si].disagreements.length;
            }
            idx += currentDisIndex;
            break;
        }
    }
    return idx;
}

function setPositionFromFlatIndex(flatIdx) {
    if (flatIdx >= flatItems.length) {
        currentBenchIndex = benchmarks.length;
        currentSentenceIndex = 0;
        currentDisIndex = 0;
        return;
    }
    const item = flatItems[flatIdx];
    currentBenchIndex = benchmarks.indexOf(item.bench);
    currentSentenceIndex = item.si;
    currentDisIndex = item.di;
}

function renderCurrent() {
    const flatIdx = getFlatIndex();

    if (flatIdx >= flatItems.length) {
        showResults();
        return;
    }

    if (!practiceCompleted && flatIdx >= PRACTICE_COUNT) {
        showPracticeTransition();
        return;
    }

    const bench = benchmarks[currentBenchIndex];
    const sentence = evalData[bench][currentSentenceIndex];
    const data = sentence.disagreements[currentDisIndex];

    if (!sentence || !data) {
        console.error("State mismatch, resetting.");
        currentDisIndex = 0;
        currentSentenceIndex = 0;
        renderCurrent();
        return;
    }

    const totalItems = flatItems.length;
    const isPractice = flatIdx < PRACTICE_COUNT;
    const displayIdx = isPractice ? flatIdx + 1 : flatIdx - PRACTICE_COUNT + 1;
    const displayTotal = isPractice ? PRACTICE_COUNT : totalItems - PRACTICE_COUNT;

    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-fill');
    const phaseLabel = document.getElementById('phase-label');

    if (isPractice) {
        progressText.textContent = `Entraînement ${displayIdx} / ${displayTotal}`;
        progressFill.style.width = `${(displayIdx / displayTotal) * 100}%`;
        phaseLabel.textContent = 'BANC D\'ESSAI';
        phaseLabel.className = 'phase-label practice';
    } else {
        progressText.textContent = `Évaluation ${displayIdx} / ${displayTotal}`;
        progressFill.style.width = `${(displayIdx / displayTotal) * 100}%`;
        phaseLabel.textContent = 'ÉVALUATION';
        phaseLabel.className = 'phase-label evaluation';
    }

    app.innerHTML = '';
    const clone = template.content.cloneNode(true);

    clone.getElementById('benchmark-name').textContent = bench.toUpperCase();
    clone.getElementById('sentence-text').textContent = sentence.text;

    // Deterministic blind A/B assignment
    const isGoldA = getAbAssignment(flatIdx);
    const conlluA = isGoldA ? sentence.gold_conllu : sentence.ia_conllu;
    const conlluB = isGoldA ? sentence.ia_conllu : sentence.gold_conllu;

    const idToWordA = parseConllu(conlluA);
    const idToWordB = parseConllu(conlluB);
    const activeTokenId = data.token_id;

    populateTable(clone.getElementById('table-a'), conlluA, activeTokenId, idToWordA);
    populateTable(clone.getElementById('table-b'), conlluB, activeTokenId, idToWordB);

    // Compute blind labels (what the annotator sees)
    const dataA = isGoldA ? data.gold : data.ia;
    const dataB = isGoldA ? data.ia : data.gold;

    clone.querySelectorAll('.btn-choice').forEach(btn => {
        btn.onclick = () => handleChoice(btn.dataset.choice, dataA, dataB);
    });

    // Back button
    const btnBack = clone.getElementById('btn-back');
    if (flatIdx === 0) {
        btnBack.disabled = true;
        btnBack.style.opacity = '0.3';
    } else {
        btnBack.onclick = () => goBack();
    }

    // Jump-to
    const jumpInput = clone.getElementById('jump-input');
    const btnJump = clone.getElementById('btn-jump');
    jumpInput.value = flatIdx + 1;
    jumpInput.max = flatItems.length;
    btnJump.onclick = () => jumpTo(parseInt(jumpInput.value));
    jumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') jumpTo(parseInt(jumpInput.value));
    });

    // Rules
    const rulesBox = clone.getElementById('rules-box');
    const labels = [dataA.deprel, dataB.deprel];
    if (dataA.head !== dataB.head) labels.push('HEAD');
    const uniqueDeprels = [...new Set(labels)];

    let rulesHtml = '';
    uniqueDeprels.forEach(dr => {
        let rule = udRules[dr];
        if (!rule) {
            const base = dr.split(':')[0];
            rule = udRules[base];
        }
        if (rule) {
            rulesHtml += `<div class="rule-item"><strong>${dr.toUpperCase()} :</strong><p>${rule.replace(/\n/g, '<br>')}</p></div>`;
        }
    });
    rulesBox.innerHTML = rulesHtml || '<p>Aucune règle spécifique trouvée pour ces relations.</p>';

    app.appendChild(clone);
}

function populateTable(table, conllu, activeTokenId, idToWord) {
    const tbody = table.querySelector('tbody');
    conllu.split('\n').forEach(line => {
        if (!line || line.startsWith('#')) return;
        const p = line.split('\t');
        if (p.length < 10) return;
        if (p[0].includes('-') || p[0].includes('.')) return;

        const row = document.createElement('tr');
        const isActive = p[0] === activeTokenId;
        if (isActive) row.className = 'diff-row';

        const headId = p[6];
        const headWord = headId === '0' ? 'ROOT' : (idToWord[headId] || '?');
        const headDisplay = headId === '0' ? '0' : `${headId} (${headWord})`;

        row.innerHTML = `
            <td>${p[0]}</td>
            <td class="${isActive ? 'diff-highlight' : ''}">${p[1]}</td>
            <td class="${isActive ? 'diff-highlight' : ''}">${headDisplay}</td>
            <td class="${isActive ? 'diff-highlight' : ''}">${p[7]}</td>
        `;
        tbody.appendChild(row);
    });
}

function parseConllu(conllu) {
    const map = {};
    conllu.split('\n').forEach(line => {
        if (!line || line.startsWith('#')) return;
        const p = line.split('\t');
        if (p.length >= 2 && !p[0].includes('-') && !p[0].includes('.')) {
            map[p[0]] = p[1];
        }
    });
    return map;
}

// === BLIND RESPONSE: only stores "a" or "b", never "gold" or "ia" ===
function handleChoice(choice, dataA, dataB) {
    const flatIdx = getFlatIndex();
    const bench = benchmarks[currentBenchIndex];
    const sentence = evalData[bench][currentSentenceIndex];
    const data = sentence.disagreements[currentDisIndex];

    const response = {
        flatIdx,
        bench,
        sent_id: sentence.sent_id,
        tokenId: data.token_id,
        word: data.form,
        labelA: `${dataA.head}:${dataA.deprel}`,
        labelB: `${dataB.head}:${dataB.deprel}`,
        winner: choice,  // "a", "b", "both_wrong", "undecidable", "dunno"
        timestamp: new Date().toISOString()
    };

    const isPractice = flatIdx < PRACTICE_COUNT;

    if (isPractice) {
        const existingIdx = practiceResponses.findIndex(r => r.flatIdx === flatIdx);
        if (existingIdx >= 0) practiceResponses[existingIdx] = response;
        else practiceResponses.push(response);
        localStorage.setItem('eval2_practice_responses', JSON.stringify(practiceResponses));
    } else {
        const existingIdx = responses.findIndex(r => r.flatIdx === flatIdx);
        if (existingIdx >= 0) responses[existingIdx] = response;
        else responses.push(response);
        localStorage.setItem('eval2_responses', JSON.stringify(responses));
    }

    // Auto-save to file
    autoSave();

    advanceToNext();
}

function autoSave() {
    const payload = {
        practice: practiceResponses,
        evaluation: responses,
        metadata: {
            practiceCount: PRACTICE_COUNT,
            totalItems: flatItems.length,
            lastSave: new Date().toISOString()
        }
    };
    fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(() => {
        // Silently fail — localStorage is the primary backup
    });
}

function advanceToNext() {
    const bench = benchmarks[currentBenchIndex];
    const sentence = evalData[bench][currentSentenceIndex];

    currentDisIndex++;
    if (currentDisIndex >= sentence.disagreements.length) {
        currentDisIndex = 0;
        currentSentenceIndex++;
        if (currentSentenceIndex >= evalData[bench].length) {
            currentSentenceIndex = 0;
            currentBenchIndex++;
        }
    }

    saveState();

    const flatIdx = getFlatIndex();
    if (!practiceCompleted && flatIdx >= PRACTICE_COUNT) {
        showPracticeTransition();
    } else if (flatIdx >= flatItems.length || currentBenchIndex >= benchmarks.length) {
        showResults();
    } else {
        renderCurrent();
    }
}

function goBack() {
    const flatIdx = getFlatIndex();
    if (flatIdx <= 0) return;
    if (practiceCompleted && flatIdx <= PRACTICE_COUNT) return;

    setPositionFromFlatIndex(flatIdx - 1);
    saveState();
    renderCurrent();
}

function jumpTo(num) {
    if (isNaN(num) || num < 1 || num > flatItems.length) {
        alert(`Numéro invalide. Entrez un nombre entre 1 et ${flatItems.length}.`);
        return;
    }

    const targetFlatIdx = num - 1;

    if (practiceCompleted && targetFlatIdx < PRACTICE_COUNT) {
        alert(`Le banc d'essai est terminé. Entrez un nombre entre ${PRACTICE_COUNT + 1} et ${flatItems.length}.`);
        return;
    }
    if (!practiceCompleted && targetFlatIdx >= PRACTICE_COUNT) {
        alert(`Terminez d'abord le banc d'essai (exemples 1 à ${PRACTICE_COUNT}).`);
        return;
    }

    setPositionFromFlatIndex(targetFlatIdx);
    saveState();
    renderCurrent();
}

function saveState() {
    const flatIdx = getFlatIndex();
    localStorage.setItem('eval2_flat_idx', flatIdx);
    localStorage.setItem('eval2_bench_idx', currentBenchIndex);
    localStorage.setItem('eval2_sent_idx', currentSentenceIndex);
    localStorage.setItem('eval2_dis_idx', currentDisIndex);
}

function showPracticeTransition() {
    app.innerHTML = '';
    const clone = practiceTemplate.content.cloneNode(true);

    const statsDiv = clone.getElementById('practice-stats');
    const total = practiceResponses.length;
    if (total > 0) {
        const aWins = practiceResponses.filter(r => r.winner === 'a').length;
        const bWins = practiceResponses.filter(r => r.winner === 'b').length;
        const bothWrong = practiceResponses.filter(r => r.winner === 'both_wrong').length;
        const undecidable = practiceResponses.filter(r => r.winner === 'undecidable').length;
        const dunno = practiceResponses.filter(r => r.winner === 'dunno').length;

        statsDiv.innerHTML = `
            <h3>Vos résultats d'entraînement :</h3>
            <div class="stats-grid">
                <div><strong>A ou B choisi :</strong> ${aWins + bWins} (${((aWins + bWins) / total * 100).toFixed(0)}%)</div>
                <div><strong>Les deux ont tort :</strong> ${bothWrong} (${(bothWrong / total * 100).toFixed(0)}%)</div>
                <div><strong>Indécidable :</strong> ${undecidable} (${(undecidable / total * 100).toFixed(0)}%)</div>
                <div><strong>Je ne sais pas :</strong> ${dunno} (${(dunno / total * 100).toFixed(0)}%)</div>
            </div>
        `;
    }

    clone.getElementById('btn-start-eval').onclick = () => {
        practiceCompleted = true;
        localStorage.setItem('eval2_practice_done', 'true');
        setPositionFromFlatIndex(PRACTICE_COUNT);
        saveState();
        renderCurrent();
    };

    app.appendChild(clone);
}

function showResults() {
    const total = responses.length;
    if (total === 0) {
        app.innerHTML = `
            <div class="container fade-in">
                <div class="sentence-display">
                    <h2>Aucune réponse enregistrée</h2>
                    <p>Il semble qu'il n'y ait pas encore de réponses d'évaluation.</p>
                </div>
            </div>
        `;
        return;
    }

    const aWins = responses.filter(r => r.winner === 'a').length;
    const bWins = responses.filter(r => r.winner === 'b').length;
    const bothWrong = responses.filter(r => r.winner === 'both_wrong').length;
    const undecidable = responses.filter(r => r.winner === 'undecidable').length;
    const dunno = responses.filter(r => r.winner === 'dunno').length;

    app.innerHTML = `
        <div class="container fade-in">
            <div class="sentence-display">
                <h2>Évaluation terminée !</h2>
                <p>Merci pour votre contribution.</p>
                <p>Vos annotations sont sauvegardées dans le dossier <code>resultats/</code>.</p>
                <div class="stats-summary" style="margin: 2rem 0; display: flex; flex-direction: column; gap: 1rem; align-items: center; font-size: 1.1rem;">
                    <div><strong>Option A choisie :</strong> ${aWins} (${((aWins / total) * 100).toFixed(1)}%)</div>
                    <div><strong>Option B choisie :</strong> ${bWins} (${((bWins / total) * 100).toFixed(1)}%)</div>
                    <div><strong>Les deux ont tort :</strong> ${bothWrong} (${((bothWrong / total) * 100).toFixed(1)}%)</div>
                    <div><strong>Indécidable :</strong> ${undecidable} (${((undecidable / total) * 100).toFixed(1)}%)</div>
                    <div><strong>Je ne sais pas :</strong> ${dunno} (${((dunno / total) * 100).toFixed(1)}%)</div>
                </div>
                <p style="margin-top:1rem; opacity:0.7;">Envoyez le fichier <code>resultats/annotations.json</code> par email.</p>
                <div style="margin-top: 2rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                    <button class="btn btn-choice btn-danger" onclick="resetProgress()">Effacer & Recommencer</button>
                </div>
            </div>
        </div>
    `;
}

window.resetProgress = function () {
    if (confirm("Attention : cela effacera toute votre progression actuelle. Continuer ?")) {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('eval2_')) keysToRemove.push(key);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        location.reload();
    }
};

init();
