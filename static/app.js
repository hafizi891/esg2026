document.addEventListener('DOMContentLoaded', () => {
    
    // --- Elements ---
    const pirIcon = document.getElementById('pir-icon');
    const pirIconContainer = document.getElementById('pir-icon-container');
    const pirText = document.getElementById('pir-text');
    const pirBadge = document.getElementById('pir-status-badge');

    const switchCheckbox = document.getElementById('switch-checkbox');
    const switchText = document.getElementById('switch-text');
    const switchBadge = document.getElementById('switch-status-badge');

    const irInput = document.getElementById('ir-code-input');
    const irBtn = document.getElementById('send-ir-btn');
    const irFeedback = document.getElementById('ir-feedback');
    const irAutoStatus = document.getElementById('ir-auto-status');

    // --- Status Fetch (initial + periodic refresh for badges) ---
    function refreshStatus() {
        fetch('/api/status')
            .then(res => res.json())
            .then(data => {
                updatePirUI(data.pir_state);
                updateBatteryUI(data.pir_battery);
                updateSwitchUI(data.switch_1);
                updateSourceBadge(pirBadge, data.pir_source, data.pir_online);
                updateSourceBadge(switchBadge, data.switch_source, data.switch_online);
                irAutoStatus.textContent = data.ir_auto_trigger_enabled
                    ? 'Auto-trigger on motion: ON'
                    : 'Auto-trigger on motion: OFF (set IR_AUTO_TRIGGER_ENABLED in app.py)';
            })
            .catch(err => {
                console.error(err);
            });
    }

    refreshStatus();
    setInterval(refreshStatus, 5000);

    // --- UI Updaters ---
    function updatePirUI(state) {
        if (state === 'pir') {
            pirIconContainer.classList.add('motion');
            pirIcon.className = 'fa-solid fa-person-running';
            pirText.textContent = 'Motion Detected!';
        } else {
            pirIconContainer.classList.remove('motion');
            pirIcon.className = 'fa-solid fa-eye-slash';
            pirText.textContent = 'No Motion Detected';
        }
    }

    function updateBatteryUI(battery) {
        const el = document.getElementById('pir-battery');
        if (!el || !battery || battery === 'unknown') return;
        const icons = { low: 'fa-battery-empty', middle: 'fa-battery-half', high: 'fa-battery-full' };
        const icon = icons[battery] || 'fa-battery-full';
        el.innerHTML = `<i class="fa-solid ${icon}"></i> Battery: ${battery.charAt(0).toUpperCase() + battery.slice(1)}`;
    }

    function updateSwitchUI(state) {
        switchCheckbox.checked = state;
        switchText.textContent = state ? 'Switch is ON' : 'Switch is OFF';
    }

    function updateSourceBadge(el, source, online) {
        if (!el || !source) return;
        el.textContent = source === 'local' ? 'Local' : 'Cloud';
        el.className = 'badge ' + (online ? 'online' : 'offline');
    }

    // --- Realtime SSE Event Listener ---
    const eventSource = new EventSource('/api/stream');
    eventSource.addEventListener('pir_update', (e) => {
        const data = JSON.parse(e.data);
        updatePirUI(data.state);
    });
    eventSource.addEventListener('switch_update', (e) => {
        const data = JSON.parse(e.data);
        updateSwitchUI(data.state);
    });
    eventSource.addEventListener('ir_auto_trigger', (e) => {
        const data = JSON.parse(e.data);
        showFeedback(data.success ? 'Motion detected — IR code auto-sent!' : 'Auto-trigger failed: ' + data.error, data.success ? 'success' : 'error');
    });

    // --- Switch Control ---
    switchCheckbox.addEventListener('change', (e) => {
        const action = e.target.checked ? 'on' : 'off';
        switchCheckbox.disabled = true; // prevent spam
        
        fetch('/api/toggle_switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action })
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                updateSwitchUI(data.state);
            } else {
                alert("Failed: " + data.error);
                switchCheckbox.checked = !e.target.checked; // revert
            }
        })
        .catch(err => console.error(err))
        .finally(() => {
            switchCheckbox.disabled = false;
        });
    });

    // --- IR Blaster Control ---
    irBtn.addEventListener('click', () => {
        const code = irInput.value.trim();
        if (!code) {
            showFeedback('Please enter a Base64 code.', 'error');
            return;
        }

        const originalHtml = irBtn.innerHTML;
        irBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        irBtn.disabled = true;

        fetch('/api/send_ir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code })
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                showFeedback('Command sent successfully!', 'success');
            } else {
                showFeedback('Failed: ' + data.error, 'error');
            }
        })
        .catch(err => {
            showFeedback('Network error.', 'error');
        })
        .finally(() => {
            irBtn.innerHTML = originalHtml;
            irBtn.disabled = false;
        });
    });

    function showFeedback(msg, type) {
        irFeedback.textContent = msg;
        irFeedback.className = 'feedback-msg ' + type;
        setTimeout(() => { irFeedback.textContent = ''; }, 3000);
    }
});
