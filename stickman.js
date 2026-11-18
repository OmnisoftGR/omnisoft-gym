// Stickman animations για τη βιβλιοθήκη ασκήσεων (SVG, χωρίς εξωτερικά αρχεία).
// Κάθε κίνηση = λίστα «στάσεων» (keyframes) που εναλλάσσονται ομαλά.
(function () {
  const S = { head:[60,18], neck:[60,30], hip:[60,62],
              eL:[58,46], hL:[58,62], eR:[62,46], hR:[62,62],
              kL:[58,86], fL:[57,110], kR:[62,86], fR:[63,110] };

  // P({...}) = όρθια στάση με αλλαγές. Συντομεύσεις: e/h = και τα δύο χέρια, k/f = και τα δύο πόδια
  function P(o, base) {
    const p = JSON.parse(JSON.stringify(base || S));
    for (const [key, v] of Object.entries(o || {})) {
      if (key === 'e') { p.eL = [v[0]-2, v[1]]; p.eR = [v[0]+2, v[1]]; }
      else if (key === 'h') { p.hL = [v[0]-2, v[1]]; p.hR = [v[0]+2, v[1]]; }
      else if (key === 'k') { p.kL = [v[0]-2, v[1]]; p.kR = [v[0]+2, v[1]]; }
      else if (key === 'f') { p.fL = [v[0]-2, v[1]]; p.fR = [v[0]+2, v[1]]; }
      else p[key] = v;
    }
    return p;
  }
  function T(p, dx, dy, keep) {
    const q = {};
    for (const [k, v] of Object.entries(p)) q[k] = (keep || []).includes(k) ? v : [v[0]+dx, v[1]+dy];
    return q;
  }
  function swapLR(p) {
    return { ...p, eL:p.eR, hL:p.hR, eR:p.eL, hR:p.hL, kL:p.kR, fL:p.fR, kR:p.kL, fR:p.fL };
  }

  const squatDown = P({ head:[66,42], neck:[64,52], hip:[46,80], e:[76,56], h:[88,54], k:[70,90], f:[62,110] });
  const hingeDown = P({ head:[92,44], neck:[82,48], hip:[56,62], e:[82,64], h:[82,80], k:[62,86] });
  const plank = { head:[102,82], neck:[90,86], hip:[52,90], eL:[88,106], hL:[102,106], eR:[90,106], hR:[104,106],
                  kL:[32,98], fL:[12,106], kR:[32,98], fR:[12,106] };
  const pushUp = { head:[100,68], neck:[88,72], hip:[50,84], eL:[86,90], hL:[86,108], eR:[90,90], hR:[90,108],
                   kL:[30,96], fL:[10,106], kR:[30,96], fR:[10,106] };
  const pushDown = { ...pushUp, head:[100,92], neck:[88,94], hip:[50,98], eL:[74,94], eR:[76,94], kL:[30,102], kR:[30,102] };
  const guard = P({ eL:[66,44], hL:[72,34], eR:[64,46], hR:[70,36], kL:[54,86], fL:[50,110], kR:[66,86], fR:[70,110] });
  const seat = P({ head:[52,24], neck:[52,36], hip:[56,70], e:[58,52], h:[66,66], k:[80,70], f:[80,94] });
  const lying = { head:[22,96], neck:[32,100], hip:[64,104], eL:[28,88], hL:[22,84], eR:[30,88], hR:[24,84],
                  kL:[82,86], fL:[96,106], kR:[84,86], fR:[98,106] };
  const run1 = P({ kL:[70,84], fL:[64,104], kR:[52,90], fR:[44,108], eL:[52,44], hL:[58,56], eR:[68,44], hR:[76,36] });
  const hang = P({ e:[64,14], h:[62,4] });
  const dipUp = P({ e:[60,46], h:[60,62], k:[66,84], f:[56,100] });

  const M = {
    stand:    { ms:2400, f:[P(), T(P(),0,1)] },
    squat:    { ms:1800, f:[P({ e:[72,40], h:[84,40] }), squatDown] },
    hinge:    { ms:1800, f:[P(), hingeDown] },
    swing:    { ms:1300, f:[hingeDown, P({ e:[76,38], h:[90,30] })] },
    pressup:  { ms:1600, f:[P({ e:[72,40], h:[70,26] }), P({ e:[64,16], h:[62,4] })] },
    pulldown: { ms:1600, f:[P({ e:[64,16], h:[62,4] }), P({ e:[72,44], h:[70,28] })] },
    row:      { ms:1500, f:[P({ e:[72,50], h:[88,50] }), P({ e:[46,50], h:[64,50] })] },
    curl:     { ms:1400, f:[P(), P({ h:[72,36] })] },
    pushdown: { ms:1400, f:[P({ e:[64,46], h:[76,36] }), P({ e:[64,46], h:[66,64] })] },
    lateral:  { ms:1500, f:[P(), P({ e:[74,34], h:[88,28] })] },
    pressfwd: { ms:1500, f:[P({ e:[52,44], h:[70,40] }), P({ e:[76,40], h:[94,40] })] },
    lunge:    { ms:1800, f:[P(), P({ head:[60,30], neck:[60,42], hip:[58,74], e:[58,58], h:[58,74],
                                     kR:[78,88], fR:[80,110], kL:[46,100], fL:[34,110] })] },
    plank:    { ms:2600, f:[plank, { ...plank, hip:[52,87] }] },
    pushup:   { ms:1500, f:[pushUp, pushDown] },
    punch:    { ms:1600, f:[guard, { ...guard, eR:[80,36], hR:[96,34] }, guard, { ...guard, eL:[82,36], hL:[98,34] }] },
    jump:     { ms:900,  f:[P({ e:[52,52], h:[46,64], k:[62,84] }), T(P({ e:[52,50], h:[46,62] }),0,-12)] },
    run:      { ms:800,  f:[run1, swapLR(run1)] },
    walk:     { ms:1400, f:[P({ kL:[64,86], fL:[68,110], kR:[56,86], fR:[52,110], e:[60,46], h:[60,64] }),
                            P({ kL:[56,86], fL:[52,110], kR:[64,86], fR:[68,110], e:[60,46], h:[60,64] })] },
    legext:   { ms:1600, f:[seat, P({ f:[102,72] }, seat)] },
    legcurl:  { ms:1600, f:[P({ f:[102,72] }, seat), seat] },
    legpress: { ms:1700, f:[P({ k:[72,52], f:[90,60] }, seat), P({ k:[86,62], f:[108,64] }, seat)] },
    calf:     { ms:1200, f:[P(), T(P(),0,-6,['fL','fR'])] },
    crunch:   { ms:1500, f:[lying, { ...lying, head:[38,80], neck:[44,90], eL:[42,78], hL:[36,74], eR:[44,78], hR:[38,74] }] },
    twist:    { ms:1200, f:[{ ...lying, head:[38,80], neck:[44,90], eL:[54,94], hL:[62,98], eR:[56,94], hR:[64,98] },
                            { ...lying, head:[38,80], neck:[44,90], eL:[34,94], hL:[28,100], eR:[36,94], hR:[30,100] }] },
    pullup:   { ms:1700, f:[T(hang,0,4,[]), T(P({ e:[72,16], h:[62,4] }),0,-14,['hL','hR'])] },
    dips:     { ms:1500, f:[dipUp, T(P({ e:[46,48], h:[60,62], k:[66,84], f:[56,100] }),0,10,['hL','hR'])] },
    hipthrust:{ ms:1600, f:[{ head:[18,76], neck:[30,80], hip:[56,100], eL:[40,92], hL:[56,98], eR:[42,92], hR:[58,98],
                              kL:[78,86], fL:[86,110], kR:[80,86], fR:[88,110] },
                            { head:[18,76], neck:[30,80], hip:[58,80], eL:[40,88], hL:[56,82], eR:[42,88], hR:[58,82],
                              kL:[80,78], fL:[86,110], kR:[82,78], fR:[88,110] }] },
  };
  M.burpee = { ms:2600, f:[P(), squatDown, pushUp, squatDown, T(P({ e:[64,16], h:[62,4] }),0,-10)] };

  const CODE = {
    squat_barbell:'squat', goblet_squat:'squat', leg_press:'legpress', leg_extension:'legext', leg_curl:'legcurl',
    lunge_dumbbell:'lunge', romanian_deadlift:'hinge', deadlift:'hinge', hip_thrust:'hipthrust', calf_raise:'calf',
    box_jump:'jump', lat_pulldown:'pulldown', seated_row:'row', db_row:'row', face_pull:'row', rowing_machine:'row',
    pull_up:'pullup', bench_press:'pressfwd', incline_db_press:'pressfwd', chest_press_machine:'pressfwd',
    pec_fly_machine:'pressfwd', push_up:'pushup', overhead_press:'pressup', db_shoulder_press:'pressup',
    lateral_raise:'lateral', biceps_curl:'curl', triceps_pushdown:'pushdown', dips:'dips', plank:'plank',
    crunch:'crunch', russian_twist:'twist', kettlebell_swing:'swing', farmer_walk:'walk', burpee:'burpee',
    jump_rope:'jump', heavy_bag:'punch', shadow_boxing:'punch', treadmill:'run'
  };

  const LIMBS = [['torso',['neck','hip']], ['armL',['neck','eL','hL']], ['legL',['hip','kL','fL']],
                 ['armR',['neck','eR','hR']], ['legR',['hip','kR','fR']]];

  function svg(code, big) {
    const parts = LIMBS.map(([n]) =>
      `<polyline data-l="${n}" ${n.endsWith('L') ? 'opacity=".5"' : ''}></polyline>`).join('');
    return `<svg class="stick${big ? ' big' : ''}" viewBox="0 0 120 120" data-anim="${code || ''}" aria-hidden="true">
      <line class="ground" x1="4" y1="112" x2="116" y2="112"></line>${parts}<circle data-l="head" r="8"></circle></svg>`;
  }

  const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
  function poseAt(m, now) {
    const n = m.f.length, seg = m.ms / n, t = (now % m.ms) / seg, i = Math.floor(t), a = m.f[i], b = m.f[(i + 1) % n];
    const k = ease(t - i), out = {};
    for (const key of Object.keys(S)) out[key] = [a[key][0] + (b[key][0]-a[key][0])*k, a[key][1] + (b[key][1]-a[key][1])*k];
    return out;
  }
  function draw(el, now) {
    const m = M[CODE[el.dataset.anim]] || M.stand, p = poseAt(m, now);
    for (const [name, pts] of LIMBS) {
      const pl = el.querySelector(`[data-l="${name}"]`);
      if (pl) pl.setAttribute('points', pts.map(k => p[k].join(',')).join(' '));
    }
    const h = el.querySelector('[data-l="head"]');
    if (h) { h.setAttribute('cx', p.head[0]); h.setAttribute('cy', p.head[1]); }
  }
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function loop(now) {
    document.querySelectorAll('svg.stick[data-anim]').forEach(el => draw(el, reduce ? 0 : now));
    if (!reduce) requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  if (reduce) new MutationObserver(() => loop(0)).observe(document.documentElement, { childList: true, subtree: true });

  // Αντιστοίχιση κωδικών βιβλιοθήκης → κίνηση από τη βάση (exercise_library.motion)
  function setMap(map) { for (const [c, m] of Object.entries(map || {})) if (m && M[m]) CODE[c] = m; }
  const MOTION_LABELS = { stand:'Όρθια στάση', squat:'Κάθισμα', hinge:'Κάμψη ισχίου', swing:'Αιώρηση', pressup:'Πιέσεις πάνω',
    pulldown:'Έλξη προς τα κάτω', row:'Κωπηλατική', curl:'Κάμψη χεριών', pushdown:'Έκταση τρικεφάλων', lateral:'Ανύψωση χεριών',
    pressfwd:'Πιέσεις μπροστά', lunge:'Προβολή', plank:'Σανίδα', pushup:'Κάμψεις', punch:'Γροθιές', jump:'Άλματα', run:'Τρέξιμο',
    walk:'Περπάτημα', legext:'Εκτάσεις ποδιών', legcurl:'Κάμψεις ποδιών', legpress:'Πρέσα ποδιών', calf:'Γάμπες',
    crunch:'Κοιλιακοί', twist:'Περιστροφές κορμού', pullup:'Έλξεις μονόζυγου', dips:'Βυθίσεις', hipthrust:'Γέφυρα ισχίου', burpee:'Burpee' };
  window.Stickman = { svg, setMap, motions: Object.keys(M), labels: MOTION_LABELS, codes: CODE,
    svgMotion: (motion, big) => svg('__m_' + motion, big) };
  for (const k of Object.keys(M)) CODE['__m_' + k] = k;
})();
