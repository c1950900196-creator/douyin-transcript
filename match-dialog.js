(function () {
    let matchDialogMatches = [];
    let matchDialogState = { selectedMatchId: null, selectedPrediction: null, callback: null, mode: null, extraData: null };
    let matchDialogApiBase = '';

    function getEl(id) {
        return document.getElementById(id);
    }

    function escAttr(text) {
        return String(text == null ? '' : text).replace(/"/g, '&quot;');
    }

    window.openMatchDialog = function (opts) {
        matchDialogApiBase = opts.apiBase || '';
        matchDialogState = {
            selectedMatchId: null,
            selectedPrediction: null,
            callback: opts.callback,
            mode: opts.mode || 'full',
            extraData: opts.extraData || {}
        };

        getEl('match-dialog-title').textContent = opts.title || '选择比赛';
        getEl('match-dialog-search').value = '';
        getEl('match-dialog-submit').disabled = true;

        if (opts.mode === 'prediction-only') {
            matchDialogState.selectedMatchId = opts.extraData?.matchId || null;
            getEl('match-dialog-search').style.display = 'none';
            getEl('match-dialog-list').style.display = 'none';
            getEl('match-dialog-prediction').style.display = 'flex';
        } else {
            getEl('match-dialog-search').style.display = '';
            getEl('match-dialog-list').style.display = '';
            getEl('match-dialog-prediction').style.display = 'none';
        }

        document.querySelectorAll('.match-dialog-prediction button').forEach(b => b.classList.remove('active'));

        fetch(`${matchDialogApiBase}/api/matches`)
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    matchDialogMatches = (res.data || []).sort((a, b) => (b.matchTime || '').localeCompare(a.matchTime || ''));
                    window.renderMatchList(matchDialogMatches);
                }
            })
            .catch(() => {
                window.renderMatchList([]);
            });

        getEl('match-dialog-overlay').classList.add('active');
    };

    window.closeMatchDialog = function () {
        getEl('match-dialog-overlay').classList.remove('active');
    };

    window.renderMatchList = function (list) {
        const container = getEl('match-dialog-list');
        if (!container) return;
        if (!list.length) {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary);">无匹配结果</div>';
            return;
        }
        container.innerHTML = list.map(m => {
            const mid = escAttr(m.matchId || '');
            const selected = matchDialogState.selectedMatchId === (m.matchId || '') ? 'selected' : '';
            const timeStr = String(m.matchTime || '').replace('T', ' ').slice(0, 16);
            const status = m.status === 'finished' ? '已结束' : m.status === 'live' ? '进行中' : '未开始';
            return `
                <div class="match-dialog-item ${selected}" data-match-id="${mid}" onclick="selectMatchFromElement(this)">
                    <div>${m.homeTeam || '主队'} vs ${m.awayTeam || '客队'}</div>
                    <div class="match-meta">${m.league || ''} · ${timeStr} · ${status}</div>
                </div>
            `;
        }).join('');
    };

    window.filterMatchList = function (keyword) {
        const kw = String(keyword || '').trim().toLowerCase();
        const filtered = kw ? matchDialogMatches.filter(m =>
            (m.homeTeam || '').toLowerCase().includes(kw) ||
            (m.awayTeam || '').toLowerCase().includes(kw) ||
            (m.league || '').toLowerCase().includes(kw)
        ) : matchDialogMatches;
        window.renderMatchList(filtered);
    };

    window.selectMatchFromElement = function (el) {
        if (!el) return;
        const matchId = el.getAttribute('data-match-id') || '';
        window.selectMatch(matchId, el);
    };

    window.selectMatch = function (matchId, el) {
        matchDialogState.selectedMatchId = matchId;
        document.querySelectorAll('.match-dialog-item').forEach(node => node.classList.remove('selected'));
        if (el) el.classList.add('selected');
        getEl('match-dialog-prediction').style.display = 'flex';
        window.updateSubmitBtn();
    };

    window.selectPredDirection = function (dir) {
        matchDialogState.selectedPrediction = dir;
        document.querySelectorAll('.match-dialog-prediction button').forEach(b => b.classList.remove('active'));
        const btn = getEl(`pred-btn-${dir}`);
        if (btn) btn.classList.add('active');
        window.updateSubmitBtn();
    };

    window.updateSubmitBtn = function () {
        getEl('match-dialog-submit').disabled = !(matchDialogState.selectedMatchId && matchDialogState.selectedPrediction);
    };

    window.submitMatchDialog = function () {
        if (typeof matchDialogState.callback === 'function') {
            matchDialogState.callback({
                matchId: matchDialogState.selectedMatchId,
                prediction: matchDialogState.selectedPrediction,
                ...matchDialogState.extraData
            });
        }
        window.closeMatchDialog();
    };
})();
