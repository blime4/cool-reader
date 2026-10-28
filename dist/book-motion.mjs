// A committed page plus one replaceable destination; animation completions own commits.
export function createBookMotion({index = 0,getLimit,animate,onCommit,onTarget = () => {},reduced = () => false}) {
  let current = index, target = index, active = null, generation = 0;
  const clamp = value => Math.max(0,Math.min(Math.max(0,getLimit()-1),Math.trunc(value) || 0));
  function discard() {
    generation++;
    const previous = active; active = null;
    previous?.animation?.cancel();
  }
  function commit(value) { current = value; onCommit(value); onTarget(target); }
  function start() {
    if (active || target === current) return;
    const turn = {from:current,to:target,generation};
    active = turn;
    try { turn.animation = animate(turn.from,turn.to); }
    catch { active = null; commit(turn.to); start(); return; }
    Promise.resolve(turn.animation.finished).then(() => {
      if (active !== turn || turn.generation !== generation) return;
      active = null;
      commit(turn.to);
      start();
    },() => {
      if (active !== turn || turn.generation !== generation) return;
      active = null;
      commit(turn.to);
      start();
    });
  }
  return {
    get index() { return current; },get target() { return target; },get busy() { return Boolean(active); },
    request(value,{animate:shouldAnimate = true} = {}) {
      target = clamp(value); onTarget(target);
      if (!shouldAnimate || reduced()) { discard(); commit(target); return; }
      if (target === current && !active) { onCommit(current); return; }
      start();
    },
    reset(value = 0) { discard(); current = target = clamp(value); onTarget(target); },
    settle() { discard(); commit(target); },
  };
}
