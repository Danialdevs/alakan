// Operator settings (gear button or key S): which camera, how to find the palm, picture orientation.
// Saved in this browser.
export function setupSettings({ source, save }) {
  const panel = document.getElementById('settings');
  const gear = document.getElementById('gear');
  const open = () => {
    render();
    panel.hidden = false;
  };
  const close = () => (panel.hidden = true);
  gear.addEventListener('click', () => (panel.hidden ? open() : close()));
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('.settings') && e.code !== 'Escape') return;
    if (e.code === 'KeyS') panel.hidden ? open() : close();
    if (e.code === 'Escape') close();
  });

  if (source.kind !== 'camera') {
    gear.hidden = true;
    return;
  }

  function render() {
    const o = source.options;
    const cams = source.devices.length ? source.devices : [{ deviceId: source.deviceId, label: source.label }];
    panel.innerHTML = `
      <h3>Настройки · Баптаулар</h3>
      <label>Камера
        <select id="sCam">${cams.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === source.deviceId ? 'selected' : ''}>${escape(d.label || `Камера ${i + 1}`)}</option>`).join('')}</select>
      </label>
      <label>Как находить ладонь
        <select id="sDetect">
          ${[['auto', 'Автоматически'], ['hand', 'Распознавание руки (веб-камера)'], ['cover', 'Ладонь закрыла камеру (сканер)'], ['both', 'Оба способа']]
            .map(([v, t]) => `<option value="${v}" ${o.detect === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </label>
      <div class="row2">
        <label>Поворот
          <select id="sRotate">${[0, 90, 180, 270].map((v) => `<option value="${v}" ${+o.rotate === v ? 'selected' : ''}>${v}°</option>`).join('')}</select>
        </label>
        <label class="check"><input type="checkbox" id="sMirror" ${o.mirror ? 'checked' : ''}/> Зеркально</label>
      </div>
      <label>Чувствительность (для сканера)
        <input type="range" id="sSens" min="0" max="1" step="0.05" value="${o.sensitivity ?? 0.5}" />
      </label>
      <div class="meter"><span>Закрыто кадра</span><b id="sCover">0%</b><span>Ладонь</span><b id="sPresent">—</b><span>Сейчас</span><b id="sMode">${source.detect}</b></div>
      <div class="buttons"><button id="sBg">Запомнить пустой кадр</button><button id="sClose">Готово</button></div>
      <p class="hint">S — настройки · L — язык · F — полный экран</p>`;

    const set = (patch) => {
      source.setOptions(patch);
      save({ camera: patch });
      document.getElementById('sMode').textContent = source.detect;
    };
    panel.querySelector('#sCam').onchange = async (e) => {
      await source.switchCamera(e.target.value);
      save({ camera: { deviceId: e.target.value } });
      render();
    };
    panel.querySelector('#sDetect').onchange = (e) => set({ detect: e.target.value });
    panel.querySelector('#sRotate').onchange = (e) => set({ rotate: +e.target.value });
    panel.querySelector('#sMirror').onchange = (e) => set({ mirror: e.target.checked });
    panel.querySelector('#sSens').oninput = (e) => set({ sensitivity: +e.target.value });
    panel.querySelector('#sBg').onclick = () => {
      source.bg = null;
      source.bgFrames = 0;
    };
    panel.querySelector('#sClose').onclick = close;
  }

  // live meter while the panel is open
  setInterval(() => {
    if (panel.hidden) return;
    const cover = document.getElementById('sCover');
    if (!cover) return;
    cover.textContent = `${Math.round((source.coverage || 0) * 100)}%`;
    document.getElementById('sPresent').textContent = source.present ? (source.handTracked ? 'да · рука' : 'да') : 'нет';
  }, 150);

}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
