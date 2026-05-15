(function () {
  'use strict';

  const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

  // ── Math helpers ─────────────────────────────────────────────────────────────

  const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const rollingMean = (arr, w) => arr.map((_, i) => {
    const sl = arr.slice(Math.max(0, i - w + 1), i + 1).filter((v) => v != null);
    return sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : null;
  });

  // ── SVG primitives ───────────────────────────────────────────────────────────

  function svgBars(values, labels, color, W, H) {
    const max = Math.max(...values, 1);
    const n = values.length;
    const slot = W / n;
    const barW = Math.max(1, Math.floor(slot) - 2);
    const usableH = H - 16;
    return values.map((v, i) => {
      const x = Math.round(i * slot + (slot - barW) / 2);
      const bh = Math.max(2, Math.round((v / max) * usableH));
      const y = usableH - bh;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${color}" rx="2" opacity="0.85"/>` +
        `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 1}" text-anchor="middle" font-size="9" fill="var(--ink-3)">${labels[i]}</text>`;
    }).join('');
  }

  // Renders a polyline; null values create gaps (line skips over missing days)
  function svgPolyline(values, color, W, H, maxVal, strokeW = 1.5) {
    const n = values.length;
    if (!n) return '';
    const max = maxVal > 0 ? maxVal : 0.001;
    // Split into contiguous segments at nulls
    const segments = [];
    let current = [];
    for (let i = 0; i < n; i++) {
      if (values[i] == null) {
        if (current.length > 1) segments.push(current);
        current = [];
      } else {
        const x = (i / Math.max(n - 1, 1)) * W;
        const y = H - (values[i] / max) * (H - 4) - 2;
        current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
    if (current.length > 1) segments.push(current);
    return segments.map((pts) =>
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`
    ).join('');
  }

  function svgDonut(slices, cx, cy, r, R) {
    const total = slices.reduce((s, sl) => s + sl.value, 0);
    if (!total) return '';
    let angle = -Math.PI / 2;
    return slices.map((sl) => {
      const sweep = (sl.value / total) * 2 * Math.PI;
      const end = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const cos = Math.cos, sin = Math.sin;
      const d = [
        `M${(cx + R * cos(angle)).toFixed(2)} ${(cy + R * sin(angle)).toFixed(2)}`,
        `A${R} ${R} 0 ${large} 1 ${(cx + R * cos(end)).toFixed(2)} ${(cy + R * sin(end)).toFixed(2)}`,
        `L${(cx + r * cos(end)).toFixed(2)} ${(cy + r * sin(end)).toFixed(2)}`,
        `A${r} ${r} 0 ${large} 0 ${(cx + r * cos(angle)).toFixed(2)} ${(cy + r * sin(angle)).toFixed(2)}Z`,
      ].join(' ');
      angle = end;
      return `<path d="${d}" fill="${sl.color}" stroke="var(--card)" stroke-width="1.5"/>`;
    }).join('');
  }

  // ── Constants ────────────────────────────────────────────────────────────────

  const BA_PROVINCES = new Set([
    'Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'CABA',
    'Capital Federal', 'GBA', 'Gran Buenos Aires',
  ]);

  // TODO: international orders that bypass ML entirely are not in this dataset; wire in when that data source is available
  const CHANNEL_COLORS = { ML: '#1d4ed8', DIRECTO: '#a27a2a', MANUAL: '#9c8f84' };

  const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  // ── Map state ────────────────────────────────────────────────────────────────

  let leafletMap       = null;
  let markerLayer      = null;
  let geoCachePromise  = null;
  let pendingMapMetrics = null; // set when renderMap is called while <details> is closed

  const fetchGeoData = () => {
    if (!geoCachePromise) {
      geoCachePromise = fetch('/ar-cities.json').then((r) => r.json()).catch(() => ({}));
    }
    return geoCachePromise;
  };

  // ── Computation ──────────────────────────────────────────────────────────────

  function compute({ rows, headers, edits }) {
    const idx = (name) => headers.indexOf(name);
    const I = {
      fecha:    idx('Fecha Compra'),
      nombre:   idx('Nombre'),
      pago:     idx('Pago'),
      cupon:    idx('Cupón'),
      recargo:  idx('Recargo MP'),
      suma:     idx('Suma Impuestos'),
      envio:    idx('Costo Envio'),
      neto:     idx('Neto'),
      localidad: idx('Localidad'),
      provincia: idx('Provincia'),
      origen:   idx('Orígen'),
    };

    const all = [
      ...(rows || []),
      ...(edits.manualRows || []),
      ...(edits.invoiceRows || []),
    ];

    // Hero metrics
    const custCnt = new Map();
    let baCount = 0;
    for (const row of all) {
      const name = (row[I.nombre] || '').trim();
      if (name) custCnt.set(name, (custCnt.get(name) || 0) + 1);
      if (I.provincia >= 0 && BA_PROVINCES.has((row[I.provincia] || '').trim())) baCount++;
    }
    const custVals = [...custCnt.values()];

    // Channel mix
    const chanMap = new Map();
    for (const row of all) {
      const orig = I.origen >= 0 ? (row[I.origen] || 'OTRO').trim() : 'OTRO';
      chanMap.set(orig, (chanMap.get(orig) || 0) + 1);
    }

    // Weekday (0 = Sunday)
    const weekday = new Array(7).fill(0);
    for (const row of all) {
      const f = I.fecha >= 0 ? row[I.fecha] : '';
      if (f) weekday[new Date(f + 'T00:00:00').getDay()]++;
    }

    // Velocity + burden — last 90 days
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today); cutoff.setDate(today.getDate() - 89);

    const dailyCnt = {}, dailyBurden = {};
    for (const row of all) {
      const f = I.fecha >= 0 ? (row[I.fecha] || '') : '';
      if (!f) continue;
      const d = new Date(f + 'T00:00:00');
      if (d < cutoff) continue;
      const key = f.slice(0, 10);
      dailyCnt[key] = (dailyCnt[key] || 0) + 1;
      const pago = I.pago >= 0 ? Number(row[I.pago] || 0) : 0;
      if (pago > 0) {
        const burden = (
          (I.recargo >= 0 ? Number(row[I.recargo] || 0) : 0) +
          (I.suma    >= 0 ? Number(row[I.suma]    || 0) : 0) +
          (I.envio   >= 0 ? Number(row[I.envio]   || 0) : 0)
        ) / pago;
        if (!dailyBurden[key]) dailyBurden[key] = { t: 0, n: 0 };
        dailyBurden[key].t += burden;
        dailyBurden[key].n++;
      }
    }

    const days90 = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(cutoff); d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const velRaw    = days90.map((k) => dailyCnt[k] || 0);
    const burdenRaw = days90.map((k) => { const b = dailyBurden[k]; return b ? b.t / b.n : null; });

    // Cupón
    let conCnt = 0, conNeto = 0, sinCnt = 0, sinNeto = 0;
    for (const row of all) {
      const cupon = I.cupon >= 0 ? Number(row[I.cupon] || 0) : 0;
      const neto  = I.neto  >= 0 ? Number(row[I.neto]  || 0) : 0;
      if (cupon > 0) { conCnt++; conNeto += neto; } else { sinCnt++; sinNeto += neto; }
    }

    // Provincia
    const provMap = new Map();
    for (const row of all) {
      const prov = I.provincia >= 0 ? (row[I.provincia] || '').trim() : '';
      if (!prov) continue;
      if (!provMap.has(prov)) provMap.set(prov, { t: 0, n: 0 });
      const s = provMap.get(prov);
      s.t += I.envio >= 0 ? Number(row[I.envio] || 0) : 0;
      s.n++;
    }
    const provRows = [...provMap.entries()]
      .map(([p, s]) => ({ prov: p, mean: s.n ? s.t / s.n : 0, cnt: s.n }))
      .sort((a, b) => b.mean - a.mean);

    const velR7  = rollingMean(velRaw, 7);
    const velR30 = rollingMean(velRaw, 30);

    // City stats (for bubble map)
    const cityMap = new Map();
    for (const row of all) {
      const loc  = I.localidad >= 0 ? (row[I.localidad] || '').trim() : '';
      const prov = I.provincia >= 0 ? (row[I.provincia] || '').trim() : '';
      if (!prov) continue;
      const key = `${loc}|${prov}`;
      if (!cityMap.has(key)) cityMap.set(key, { orders: 0, neto: 0 });
      const s = cityMap.get(key);
      s.orders++;
      s.neto += I.neto >= 0 ? Number(row[I.neto] || 0) : 0;
    }

    return {
      total: all.length,
      uniqueCust: custCnt.size,
      repeatRate: custCnt.size ? custVals.filter((v) => v > 1).length / custCnt.size : 0,
      medianOrd: median(custVals),
      pctBA: all.length ? baCount / all.length : 0,
      chanMap,
      weekday,
      velR7, velR30,
      conCnt, conNeto, sinCnt, sinNeto,
      provRows,
      burdenR30: rollingMean(burdenRaw, 30),
      cityMap,
    };
  }

  // ── Map rendering ────────────────────────────────────────────────────────────

  async function renderMap(m) {
    if (typeof L === 'undefined' || !m.cityMap.size) return;

    // If the <details> is currently closed, defer until the user opens it
    const detailsEl = document.getElementById('insights');
    if (detailsEl && !detailsEl.open) {
      pendingMapMetrics = m;
      return;
    }
    pendingMapMetrics = null;

    if (!leafletMap) {
      const container = document.getElementById('ins-map-container');
      if (!container) return;
      // OSM tiles are fine for personal use; switch to MapTiler/Stadia if traffic grows
      leafletMap = L.map(container, { zoomControl: true }).setView([-38, -63], 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(leafletMap);
      markerLayer = L.layerGroup().addTo(leafletMap);
    }

    markerLayer.clearLayers();

    const geoData = await fetchGeoData();

    // Quintile thresholds on neto for opacity ramp
    const netoArr = [...m.cityMap.values()].map((s) => s.neto).sort((a, b) => a - b);
    const qLen = netoArr.length;
    const thresholds = [0.2, 0.4, 0.6, 0.8].map((p) => netoArr[Math.min(Math.floor(p * qLen), qLen - 1)] ?? 0);
    const quintile  = (neto) => { let i = 0; while (i < 4 && neto > thresholds[i]) i++; return i; };
    const opacities = [0.15, 0.35, 0.55, 0.75, 1.0];

    const orderCounts = [...m.cityMap.values()].map((s) => s.orders);
    const maxSqrt     = Math.sqrt(Math.max(...orderCounts, 1));
    const totalNeto   = netoArr.reduce((a, b) => a + b, 0);

    for (const [key, stats] of m.cityMap) {
      const pipeIdx = key.indexOf('|');
      const loc  = key.slice(0, pipeIdx);
      const prov = key.slice(pipeIdx + 1);
      const coords    = geoData[key] || geoData[`|${prov}`];
      if (!coords) continue;

      const isFallback = !geoData[key];
      const radius  = 4 + (Math.sqrt(stats.orders) / maxSqrt) * 22;
      const opacity = opacities[quintile(stats.neto)];

      L.circleMarker(coords, {
        radius,
        fillColor:   '#1d4ed8',
        fillOpacity: opacity,
        color:       '#1d4ed8',
        weight:      isFallback ? 1 : 0,
        dashArray:   isFallback ? '3 3' : undefined,
      })
      .bindPopup(
        `<b>${loc || prov}</b>${isFallback ? ' <span style="color:#9c8f84;font-size:.85em">(centroide)</span>' : ''}<br>` +
        `Pedidos: ${stats.orders}<br>` +
        `Neto: ${ars.format(stats.neto)}<br>` +
        `% del total: ${totalNeto ? (stats.neto / totalNeto * 100).toFixed(1) : 0}%`
      )
      .addTo(markerLayer);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  const $  = (id) => document.getElementById(id);
  const ey = (t)  => `<div class="kpi-card__eyebrow" style="margin-bottom:.5rem">${t}</div>`;
  const kv = (v)  => `<div class="kpi-card__value" style="font-size:clamp(1.1rem,2vw,1.8rem)">${v}</div>`;

  const thSt = 'padding:.3rem .4rem;font-size:.65rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);border-bottom:1px solid var(--border)';

  function render(m) {
    if (!m.total) {
      ['ins-hero-clientes','ins-hero-recompra','ins-hero-mediana','ins-hero-ba',
       'ins-channel','ins-weekday','ins-velocity','ins-cupon','ins-provincia','ins-carga']
        .forEach((id) => { const el = $(id); if (el) el.innerHTML = `<span style="font-size:.8rem;color:var(--ink-3)">Sin datos</span>`; });
      return;
    }

    // ── Hero strip ──────────────────────────────────────────────────────────
    $('ins-hero-clientes').innerHTML = ey('Clientes únicos')         + kv(m.uniqueCust);
    $('ins-hero-recompra').innerHTML = ey('Tasa de recompra')        + kv((m.repeatRate * 100).toFixed(1) + '%');
    $('ins-hero-mediana').innerHTML  = ey('Mediana pedidos/cliente') + kv(m.medianOrd % 1 ? m.medianOrd.toFixed(1) : String(m.medianOrd));
    $('ins-hero-ba').innerHTML       = ey('% BA / CABA')             + kv((m.pctBA * 100).toFixed(1) + '%');

    // ── Channel mix ─────────────────────────────────────────────────────────
    const slices = [...m.chanMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([o, c]) => ({ value: c, color: CHANNEL_COLORS[o] || '#c8bfa8', label: o }));
    const chanTotal = slices.reduce((s, sl) => s + sl.value, 0);
    const legend = slices.map((sl) =>
      `<div style="display:flex;align-items:center;gap:.4rem">
        <span style="width:8px;height:8px;border-radius:50%;background:${sl.color};flex-shrink:0"></span>
        <span style="font-size:.75rem;color:var(--ink-2)">${sl.label}</span>
        <span style="margin-left:auto;font-size:.75rem;color:var(--ink-3)">${sl.value}</span>
      </div>`).join('');
    $('ins-channel').innerHTML = `${ey('Mix de canales')}
      <div style="display:flex;gap:1.5rem;align-items:center;flex:1">
        <svg viewBox="0 0 100 100" width="88" height="88" style="flex-shrink:0">
          ${svgDonut(slices, 50, 50, 27, 46)}
          <text x="50" y="55" text-anchor="middle" font-size="13" fill="var(--ink)" font-weight="600">${chanTotal}</text>
        </svg>
        <div style="display:flex;flex-direction:column;gap:.45rem;flex:1">${legend}</div>
      </div>`;

    // ── Día de la semana ────────────────────────────────────────────────────
    $('ins-weekday').innerHTML = `${ey('Pedidos por día de la semana')}
      <svg viewBox="0 0 280 80" width="100%" style="display:block;overflow:visible;margin-top:.25rem">
        ${svgBars(m.weekday, WEEKDAY_LABELS, '#1d4ed8', 280, 80)}
      </svg>`;

    // ── Velocidad ───────────────────────────────────────────────────────────
    const vMax = Math.max(
      ...m.velR7.filter((v)  => v != null),
      ...m.velR30.filter((v) => v != null),
      0.001,
    );
    const lastR7  = [...m.velR7].reverse().find((v)  => v != null);
    const lastR30 = [...m.velR30].reverse().find((v) => v != null);
    $('ins-velocity').innerHTML = `${ey('Velocidad de pedidos — media móvil (últimos 90 días)')}
      <div style="display:flex;gap:2rem;margin-bottom:.35rem">
        <span>
          <span style="display:inline-block;width:10px;height:2px;background:#1d4ed8;vertical-align:middle;margin-right:.3rem"></span>
          <span style="font-size:.72rem;color:var(--ink-3)">Media 7d: </span>
          <span style="font-size:.8rem;font-weight:600">${lastR7 != null ? lastR7.toFixed(1) + ' ped/día' : '—'}</span>
        </span>
        <span>
          <span style="display:inline-block;width:10px;height:2px;background:#c8bfa8;vertical-align:middle;margin-right:.3rem"></span>
          <span style="font-size:.72rem;color:var(--ink-3)">Media 30d: </span>
          <span style="font-size:.8rem;font-weight:600">${lastR30 != null ? lastR30.toFixed(1) + ' ped/día' : '—'}</span>
        </span>
      </div>
      <svg viewBox="0 0 400 64" width="100%" style="display:block">
        ${svgPolyline(m.velR30, '#c8bfa8', 400, 64, vMax, 1.5)}
        ${svgPolyline(m.velR7,  '#1d4ed8', 400, 64, vMax, 1.5)}
      </svg>`;

    // ── Cupón impact ────────────────────────────────────────────────────────
    const aovCon = m.conCnt ? m.conNeto / m.conCnt : null;
    const aovSin = m.sinCnt ? m.sinNeto / m.sinCnt : null;
    const pctCup = m.total  ? (m.conCnt / m.total * 100).toFixed(1) + '%' : '—';
    const stat = (label, v) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:.2rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.75rem;color:var(--ink-3)">${label}</span>
        <span style="font-size:.8rem;font-weight:600;color:var(--ink)">${v}</span>
      </div>`;
    $('ins-cupon').innerHTML = `${ey('Impacto de cupones')}
      <div style="display:flex;flex-direction:column;flex:1;justify-content:center">
        ${stat('% pedidos con cupón', pctCup)}
        ${stat('AOV con cupón', aovCon != null ? ars.format(aovCon) : '—')}
        ${stat('AOV sin cupón', aovSin != null ? ars.format(aovSin) : '—')}
        ${stat('Pedidos con cupón', m.conCnt)}
      </div>`;

    // ── Envío por provincia ─────────────────────────────────────────────────
    const pRows = m.provRows.slice(0, 10).map(({ prov, mean, cnt }) =>
      `<tr>
        <td style="padding:.3rem .4rem;font-size:.75rem;color:var(--ink-2)">${prov}</td>
        <td style="padding:.3rem .4rem;font-size:.75rem;text-align:right;color:var(--ink)">${ars.format(mean)}</td>
        <td style="padding:.3rem .4rem;font-size:.75rem;text-align:right;color:var(--ink-3)">${cnt}</td>
      </tr>`).join('');
    $('ins-provincia').innerHTML = `${ey('Envío por provincia — media (top 10)')}
      <div style="overflow-x:auto;flex:1">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thSt};text-align:left">Provincia</th>
            <th style="${thSt};text-align:right">Media envío</th>
            <th style="${thSt};text-align:right">Pedidos</th>
          </tr></thead>
          <tbody>${pRows || `<tr><td colspan="3" style="font-size:.75rem;color:var(--ink-3);padding:.5rem">Sin datos de provincia</td></tr>`}</tbody>
        </table>
      </div>`;

    // ── Carga efectiva ──────────────────────────────────────────────────────
    const burdenValid = m.burdenR30.filter((v) => v != null);
    const lastBurden  = burdenValid.length ? burdenValid[burdenValid.length - 1] : null;
    const bMax = Math.max(...burdenValid, 0.001);
    $('ins-carga').innerHTML = `${ey('Carga efectiva — (Recargo + Impuestos + Envío) / Pago, media 30d')}
      <div style="margin-bottom:.35rem">
        <span style="font-size:.72rem;color:var(--ink-3)">Actual (media 30d): </span>
        <span style="font-size:.9rem;font-weight:700;color:var(--ink)">${lastBurden != null ? (lastBurden * 100).toFixed(1) + '%' : '—'}</span>
      </div>
      <svg viewBox="0 0 400 64" width="100%" style="display:block">
        ${svgPolyline(m.burdenR30, '#a27a2a', 400, 64, bMax, 1.5)}
      </svg>`;

    // ── Map (async, fire-and-forget) ────────────────────────────────────────────
    renderMap(m).catch(() => {});
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  window.addEventListener('pignus-data', () => {
    const d = window.PIGNUS_DATA;
    if (d) render(compute(d));
  });

  // When the <details> opens: fix Leaflet if already initialised, or run the deferred first render
  const insDetails = document.getElementById('insights');
  if (insDetails) {
    insDetails.addEventListener('toggle', () => {
      if (!insDetails.open) return;
      if (leafletMap) {
        leafletMap.invalidateSize();
      } else if (pendingMapMetrics) {
        renderMap(pendingMapMetrics).catch(() => {});
      }
    });
  }
})();
