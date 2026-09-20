/** 每次只推进一个激活/会战回合，把控制权交回界面以便关闭开关。 */
export class AutoBattleLoop {
  private timer?: ReturnType<typeof setTimeout>;
  private enabled = false;
  private epoch = 0;
  get running(): boolean { return this.enabled; }
  stop(): void {
    this.epoch++;
    this.enabled = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  start(step: () => boolean | Promise<boolean>, changed: () => void, failed: (error: unknown) => void): void {
    this.stop(); this.enabled = true;
    const epoch = this.epoch;
    const tick = () => {
      this.timer = undefined;
      if (!this.enabled) return;
      const finish = (keepGoing: boolean) => {
        if (epoch !== this.epoch) return;
        if (!keepGoing) this.stop();
        changed();
        if (this.enabled && epoch === this.epoch) this.timer = setTimeout(tick, 250);
      };
      const reject = (error: unknown) => { if (epoch !== this.epoch) return; this.stop(); failed(error); changed(); };
      try { const result = step(); if (typeof result === 'boolean') finish(result); else void result.then(finish, reject); }
      catch (error) { reject(error); }
    };
    this.timer = setTimeout(tick, 250);
  }
}
