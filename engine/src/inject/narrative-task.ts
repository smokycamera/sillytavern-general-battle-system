/** 所有结算、终章与战况输出共用的默认附加提示词。 */
export const SETTLEMENT_PROMPT = '根据战斗情况描写战斗过程，不得出现血量，骰子点数，字母坐标，回合数等词。谨慎使用物品、单位全名，人数等具体数值。';
export const ENGLISH_SETTLEMENT_PROMPT = 'Describe the battle using the recorded events. In the narration, omit HP, dice rolls, map coordinates, and round numbers. Use full unit and item names, headcounts, and other exact figures sparingly.';
export const NARRATIVE_TASK = '【叙述任务】\n' + SETTLEMENT_PROMPT;
