export class BattlefieldPlanError extends Error {
    constructor(message: string) { super(message); this.name = 'BattlefieldPlanError'; }
}
