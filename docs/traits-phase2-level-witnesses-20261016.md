# 第二阶段逐级差异矩阵

由 `npx vite-node scripts/audit-traits-phase2.ts` 从实际引擎入口生成。每种战斗模式独立检查9次相邻升级；数值为执行预算、合法成本、可见集合或已保存余量的确定性观测值。固定训练level5、武器规格L10、无甲；小战个体/会战编队。具体场景字段含地形、远近战、冲锋、移动/掩护或对手L与距离；完整输入及两级全部候选结果保存在 `.diagnostics/traits-phase2-20261016/level-witness-matrix.json`。脚本检查所有观测值有限且升级不退步；本表列出每次升级的首个见证。

|特质|模式|相邻升级|见证字段/前提|前|后|实际入口|
|---|---|---|---|---:|---:|---|
|林地专精|small|L1→L2|terrain movement cost|-2|-1.75|tileCost / formationMarchCost|
|林地专精|small|L2→L3|terrain movement cost|-1.75|-1.5|tileCost / formationMarchCost|
|林地专精|small|L3→L4|terrain movement cost|-1.5|-1.25|tileCost / formationMarchCost|
|林地专精|small|L4→L5|terrain movement cost|-1.25|-1|tileCost / formationMarchCost|
|林地专精|small|L5→L6|forest:false:false:defense|0|1|collectMods → resolveStack|
|林地专精|small|L6→L7|forest:false:false:attack|0|1|collectMods → resolveStack|
|林地专精|small|L7→L8|legal terrain concealment|0|1|collectMods → resolveStack|
|林地专精|small|L8→L9|forest:false:false:defense|1|2|collectMods → resolveStack|
|林地专精|small|L9→L10|forest:false:false:attack|1|2|collectMods → resolveStack|
|山地专精|small|L1→L2|terrain movement cost|-2|-1.75|tileCost / formationMarchCost|
|山地专精|small|L2→L3|terrain movement cost|-1.75|-1.5|tileCost / formationMarchCost|
|山地专精|small|L3→L4|terrain movement cost|-1.5|-1.25|tileCost / formationMarchCost|
|山地专精|small|L4→L5|terrain movement cost|-1.25|-1|tileCost / formationMarchCost|
|山地专精|small|L5→L6|hill:false:false:defense|1|2|collectMods → resolveStack|
|山地专精|small|L6→L7|hill:false:false:attack|0|1|collectMods → resolveStack|
|山地专精|small|L7→L8|legal terrain concealment|0|1|collectMods → resolveStack|
|山地专精|small|L8→L9|hill:false:false:defense|2|3|collectMods → resolveStack|
|山地专精|small|L9→L10|hill:false:false:attack|1|2|collectMods → resolveStack|
|夜战专精|small|L1→L2|night:attack|-2|-1|collectMods → resolveStack|
|夜战专精|small|L2→L3|night visible:5|0|1|collectMods → resolveStack|
|夜战专精|small|L3→L4|night mobility|2|3|collectMods → resolveStack|
|夜战专精|small|L4→L5|night visible:6|0|1|collectMods → resolveStack|
|夜战专精|small|L5→L6|night visible:7|0|1|collectMods → resolveStack|
|夜战专精|small|L6→L7|night:attack|0|1|collectMods → resolveStack|
|夜战专精|small|L7→L8|night visible:8|0|1|collectMods → resolveStack|
|夜战专精|small|L8→L9|night:defense|0|1|collectMods → resolveStack|
|夜战专精|small|L9→L10|night:attack|1|2|collectMods → resolveStack|
|平原专精|small|L1→L2|plains mobility|3|4|collectMods → resolveStack|
|平原专精|small|L2→L3|open:false:false:initiative|3|4|collectMods → resolveStack|
|平原专精|small|L3→L4|open:false:true:attack|0|1|collectMods → resolveStack|
|平原专精|small|L4→L5|open:false:false:attack|0|1|collectMods → resolveStack|
|平原专精|small|L5→L6|open:false:false:defense|0|1|collectMods → resolveStack|
|平原专精|small|L6→L7|open:false:false:initiative|4|5|collectMods → resolveStack|
|平原专精|small|L7→L8|open:false:true:attack|1|2|collectMods → resolveStack|
|平原专精|small|L8→L9|plains mobility|4|5|collectMods → resolveStack|
|平原专精|small|L9→L10|open:false:false:attack|1|2|collectMods → resolveStack|
|巷战专精|small|L1→L2|street:false:false:attack|0|1|collectMods → resolveStack|
|巷战专精|small|L2→L3|street:false:false:defense|1|2|collectMods → resolveStack|
|巷战专精|small|L3→L4|street:true:false:attack|0|1|collectMods → resolveStack|
|巷战专精|small|L4→L5|urban long shot:attack|0|1|collectMods → resolveStack|
|巷战专精|small|L5→L6|street:false:false:initiative|2|3|collectMods → resolveStack|
|巷战专精|small|L6→L7|street:false:false:defense|2|3|collectMods → resolveStack|
|巷战专精|small|L7→L8|street:false:false:attack|1|2|collectMods → resolveStack|
|巷战专精|small|L8→L9|urban concealment|0|1|collectMods → resolveStack|
|巷战专精|small|L9→L10|street:true:false:attack|1|2|collectMods → resolveStack|
|守护|small|L1→L2|false:false:false:false:false:reduction|0.050000000000000044|0.09999999999999998|collectMods → resolveStack|
|守护|small|L2→L3|false:false:false:false:false:reduction|0.09999999999999998|0.15000000000000002|collectMods → resolveStack|
|守护|small|L3→L4|false:false:false:false:false:reduction|0.15000000000000002|0.19999999999999996|collectMods → resolveStack|
|守护|small|L4→L5|false:false:false:false:false:reduction|0.19999999999999996|0.25|collectMods → resolveStack|
|守护|small|L5→L6|false:false:false:false:false:reduction|0.25|0.30000000000000004|collectMods → resolveStack|
|守护|small|L6→L7|false:false:false:false:false:reduction|0.30000000000000004|0.35|collectMods → resolveStack|
|守护|small|L7→L8|false:false:false:false:false:reduction|0.35|0.4|collectMods → resolveStack|
|守护|small|L8→L9|false:false:false:false:false:reduction|0.4|0.42500000000000004|collectMods → resolveStack|
|守护|small|L9→L10|false:false:false:false:false:reduction|0.42500000000000004|0.44999999999999996|collectMods → resolveStack|
|吸血|small|L1→L2|actual life loss converted|50|100|lifestealAmount|
|吸血|small|L2→L3|actual life loss converted|100|150|lifestealAmount|
|吸血|small|L3→L4|actual life loss converted|150|200|lifestealAmount|
|吸血|small|L4→L5|actual life loss converted|200|250|lifestealAmount|
|吸血|small|L5→L6|actual life loss converted|250|280|lifestealAmount|
|吸血|small|L6→L7|actual life loss converted|280|310|lifestealAmount|
|吸血|small|L7→L8|actual life loss converted|310|340|lifestealAmount|
|吸血|small|L8→L9|actual life loss converted|340|370|lifestealAmount|
|吸血|small|L9→L10|actual life loss converted|370|400|lifestealAmount|
|偷袭|small|L1→L2|false:false:false:false:false:damage|1.1|1.2|collectMods → resolveStack|
|偷袭|small|L2→L3|false:false:false:false:false:damage|1.2|1.3|collectMods → resolveStack|
|偷袭|small|L3→L4|false:false:false:false:false:damage|1.3|1.4|collectMods → resolveStack|
|偷袭|small|L4→L5|false:false:false:false:false:damage|1.4|1.5|collectMods → resolveStack|
|偷袭|small|L5→L6|false:false:false:false:false:damage|1.5|1.55|collectMods → resolveStack|
|偷袭|small|L6→L7|false:false:false:false:false:damage|1.55|1.6|collectMods → resolveStack|
|偷袭|small|L7→L8|false:false:false:false:false:damage|1.6|1.65|collectMods → resolveStack|
|偷袭|small|L8→L9|false:false:false:false:false:damage|1.65|1.7|collectMods → resolveStack|
|偷袭|small|L9→L10|false:false:false:false:false:damage|1.7|1.75|collectMods → resolveStack|
|耐力训练|small|L1→L2|actual fatigue ledger|-0.45|-0.4|collectMods → resolveStack|
|耐力训练|small|L2→L3|actual fatigue ledger|-0.4|-0.35|collectMods → resolveStack|
|耐力训练|small|L3→L4|actual fatigue ledger|-0.35|-0.3|collectMods → resolveStack|
|耐力训练|small|L4→L5|actual fatigue ledger|-0.3|-0.25|collectMods → resolveStack|
|耐力训练|small|L5→L6|actual fatigue ledger|-0.25|-0.235|collectMods → resolveStack|
|耐力训练|small|L6→L7|actual fatigue ledger|-0.235|-0.22|collectMods → resolveStack|
|耐力训练|small|L7→L8|actual fatigue ledger|-0.22|-0.205|collectMods → resolveStack|
|耐力训练|small|L8→L9|actual fatigue ledger|-0.205|-0.19|collectMods → resolveStack|
|耐力训练|small|L9→L10|actual fatigue ledger|-0.19|-0.175|collectMods → resolveStack|
|践踏|small|L1→L2|false:true:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|践踏|small|L2→L3|false:true:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|践踏|small|L3→L4|false:true:false:false:false:damage|1.15|1.2|collectMods → resolveStack|
|践踏|small|L4→L5|false:true:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|践踏|small|L5→L6|false:true:false:false:false:damage|1.25|1.28|collectMods → resolveStack|
|践踏|small|L6→L7|false:true:false:false:false:damage|1.28|1.31|collectMods → resolveStack|
|践踏|small|L7→L8|false:true:false:false:false:damage|1.31|1.34|collectMods → resolveStack|
|践踏|small|L8→L9|false:true:false:false:false:damage|1.34|1.37|collectMods → resolveStack|
|践踏|small|L9→L10|false:true:false:false:false:damage|1.37|1.4|collectMods → resolveStack|
|盾墙|small|L1→L2|true:false:false:false:false:reduction|0.09999999999999998|0.17999999999999994|collectMods → resolveStack|
|盾墙|small|L2→L3|true:false:false:false:false:reduction|0.17999999999999994|0.26|collectMods → resolveStack|
|盾墙|small|L3→L4|true:false:false:false:false:reduction|0.26|0.33000000000000007|collectMods → resolveStack|
|盾墙|small|L4→L5|true:false:false:false:false:reduction|0.33000000000000007|0.4|collectMods → resolveStack|
|盾墙|small|L5→L6|true:false:false:false:false:reduction|0.4|0.42999999999999994|collectMods → resolveStack|
|盾墙|small|L6→L7|true:false:false:false:false:reduction|0.42999999999999994|0.45999999999999996|collectMods → resolveStack|
|盾墙|small|L7→L8|true:false:false:false:false:reduction|0.45999999999999996|0.49|collectMods → resolveStack|
|盾墙|small|L8→L9|true:false:false:false:false:reduction|0.49|0.52|collectMods → resolveStack|
|盾墙|small|L9→L10|true:false:false:false:false:reduction|0.52|0.55|collectMods → resolveStack|
|破甲|small|L1→L2|real kinetic penetration|22.2|22.4|penetrationContext|
|破甲|small|L2→L3|real kinetic penetration|22.4|22.6|penetrationContext|
|破甲|small|L3→L4|real kinetic penetration|22.6|22.8|penetrationContext|
|破甲|small|L4→L5|real kinetic penetration|22.8|23|penetrationContext|
|破甲|small|L5→L6|real kinetic penetration|23|23.25|penetrationContext|
|破甲|small|L6→L7|real kinetic penetration|23.25|23.5|penetrationContext|
|破甲|small|L7→L8|real kinetic penetration|23.5|24|penetrationContext|
|破甲|small|L8→L9|real kinetic penetration|24|24.25|penetrationContext|
|破甲|small|L9→L10|real kinetic penetration|24.25|24.5|penetrationContext|
|克制步兵|small|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|克制步兵|small|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|克制步兵|small|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|克制步兵|small|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|克制步兵|small|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|克制步兵|small|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|克制步兵|small|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|克制步兵|small|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|克制步兵|small|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|克制大型|small|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|克制大型|small|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|克制大型|small|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|克制大型|small|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|克制大型|small|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|克制大型|small|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|克制大型|small|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|克制大型|small|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|克制大型|small|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|顽固|small|L1→L2|effective morale|43|46|moraleProfile|
|顽固|small|L2→L3|effective morale|46|49|moraleProfile|
|顽固|small|L3→L4|effective morale|49|52|moraleProfile|
|顽固|small|L4→L5|effective morale|52|55|moraleProfile|
|顽固|small|L5→L6|effective morale|55|57|moraleProfile|
|顽固|small|L6→L7|effective morale|57|59|moraleProfile|
|顽固|small|L7→L8|effective morale|59|61|moraleProfile|
|顽固|small|L8→L9|effective morale|61|63|moraleProfile|
|顽固|small|L9→L10|effective morale|63|65|moraleProfile|
|统率|small|L1→L2|effective morale|42|44|moraleProfile|
|统率|small|L2→L3|effective morale|44|46|moraleProfile|
|统率|small|L3→L4|effective morale|46|48|moraleProfile|
|统率|small|L4→L5|effective morale|48|50|moraleProfile|
|统率|small|L5→L6|effective morale|50|52|moraleProfile|
|统率|small|L6→L7|effective morale|52|54|moraleProfile|
|统率|small|L7→L8|effective morale|54|56|moraleProfile|
|统率|small|L8→L9|effective morale|56|58|moraleProfile|
|统率|small|L9→L10|effective morale|58|60|moraleProfile|
|再生|small|L1→L2|three legal periods including saved remainder|2.25|4.5|settleRegeneration(regenerationAmount)|
|再生|small|L2→L3|three legal periods including saved remainder|4.5|6.75|settleRegeneration(regenerationAmount)|
|再生|small|L3→L4|three legal periods including saved remainder|6.75|7.875|settleRegeneration(regenerationAmount)|
|再生|small|L4→L5|three legal periods including saved remainder|7.875|9|settleRegeneration(regenerationAmount)|
|再生|small|L5→L6|three legal periods including saved remainder|9|10.125|settleRegeneration(regenerationAmount)|
|再生|small|L6→L7|three legal periods including saved remainder|10.125|21.5667|settleRegeneration(regenerationAmount)|
|再生|small|L7→L8|three legal periods including saved remainder|21.5667|51.0252|settleRegeneration(regenerationAmount)|
|再生|small|L8→L9|three legal periods including saved remainder|51.0252|153.7044|settleRegeneration(regenerationAmount)|
|再生|small|L9→L10|three legal periods including saved remainder|153.7044|555.492|settleRegeneration(regenerationAmount)|
|医护|small|L1→L2|actual healing budget|1050|1100|healingYield|
|医护|small|L2→L3|actual healing budget|1100|1150|healingYield|
|医护|small|L3→L4|actual healing budget|1150|1200|healingYield|
|医护|small|L4→L5|actual healing budget|1200|1250|healingYield|
|医护|small|L5→L6|actual healing budget|1250|1280|healingYield|
|医护|small|L6→L7|actual healing budget|1280|1310|healingYield|
|医护|small|L7→L8|actual healing budget|1310|1340|healingYield|
|医护|small|L8→L9|actual healing budget|1340|1370|healingYield|
|医护|small|L9→L10|actual healing budget|1370|1400|healingYield|
|淬毒|small|L1→L2|frozen DOT expectation at roll4|1|2|weaponConditions → conditionDamage|
|淬毒|small|L2→L3|frozen DOT expectation at roll4|2|3|weaponConditions → conditionDamage|
|淬毒|small|L3→L4|frozen DOT expectation at roll4|3|3.5|weaponConditions → conditionDamage|
|淬毒|small|L4→L5|frozen DOT expectation at roll4|3.5|4|weaponConditions → conditionDamage|
|淬毒|small|L5→L6|frozen DOT expectation at roll4|4|4.5|weaponConditions → conditionDamage|
|淬毒|small|L6→L7|frozen DOT expectation at roll4|4.5|5.25|weaponConditions → conditionDamage|
|淬毒|small|L7→L8|frozen DOT expectation at roll4|5.25|6|weaponConditions → conditionDamage|
|淬毒|small|L8→L9|frozen DOT expectation at roll4|6|7|weaponConditions → conditionDamage|
|淬毒|small|L9→L10|frozen DOT expectation at roll4|7|8|weaponConditions → conditionDamage|
|恐惧|small|L1→L2|effective morale|-38|-37|moraleProfile|
|恐惧|small|L2→L3|effective morale|-37|-35|moraleProfile|
|恐惧|small|L3→L4|effective morale|-35|-34|moraleProfile|
|恐惧|small|L4→L5|effective morale|-34|-32|moraleProfile|
|恐惧|small|L5→L6|effective morale|-32|-30|moraleProfile|
|恐惧|small|L6→L7|effective morale|-30|-28|moraleProfile|
|恐惧|small|L7→L8|effective morale|-28|-25|moraleProfile|
|恐惧|small|L8→L9|effective morale|-25|-23|moraleProfile|
|恐惧|small|L9→L10|effective morale|-23|-22|moraleProfile|
|工事|small|L1→L2|true:false:false:false:false:reduction|0.09999999999999998|0.15000000000000002|collectMods → resolveStack|
|工事|small|L2→L3|false:false:false:false:false:defense|1|2|collectMods → resolveStack|
|工事|small|L3→L4|true:false:false:false:false:reduction|0.19999999999999996|0.25|collectMods → resolveStack|
|工事|small|L4→L5|false:false:false:false:false:defense|2|3|collectMods → resolveStack|
|工事|small|L5→L6|true:false:false:false:false:reduction|0.30000000000000004|0.33000000000000007|collectMods → resolveStack|
|工事|small|L6→L7|true:false:false:false:false:reduction|0.33000000000000007|0.36|collectMods → resolveStack|
|工事|small|L7→L8|false:false:false:false:false:defense|3|4|collectMods → resolveStack|
|工事|small|L8→L9|true:false:false:false:false:reduction|0.39|0.41999999999999993|collectMods → resolveStack|
|工事|small|L9→L10|false:false:false:false:false:defense|4|5|collectMods → resolveStack|
|拒马|small|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|拒马|small|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|拒马|small|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|拒马|small|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|拒马|small|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|拒马|small|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|拒马|small|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|拒马|small|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|拒马|small|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|散兵|small|L1→L2|false:false:false:false:false:reduction|0.09999999999999998|0.19999999999999996|collectMods → resolveStack|
|散兵|small|L2→L3|false:false:false:false:false:reduction|0.19999999999999996|0.30000000000000004|collectMods → resolveStack|
|散兵|small|L3→L4|false:false:false:false:false:reduction|0.30000000000000004|0.4|collectMods → resolveStack|
|散兵|small|L4→L5|false:false:false:false:false:reduction|0.4|0.5|collectMods → resolveStack|
|散兵|small|L5→L6|false:false:false:false:false:reduction|0.5|0.53|collectMods → resolveStack|
|散兵|small|L6→L7|false:false:false:false:false:reduction|0.53|0.56|collectMods → resolveStack|
|散兵|small|L7→L8|false:false:false:false:false:reduction|0.56|0.59|collectMods → resolveStack|
|散兵|small|L8→L9|false:false:false:false:false:reduction|0.59|0.62|collectMods → resolveStack|
|散兵|small|L9→L10|false:false:false:false:false:reduction|0.62|0.65|collectMods → resolveStack|
|游击|small|L1→L2|false:false:false:false:false:initiative|2|3|collectMods → resolveStack|
|游击|small|L2→L3|true:false:false:false:false:reduction|0.09999999999999998|0.15000000000000002|collectMods → resolveStack|
|游击|small|L3→L4|false:false:false:false:false:initiative|3|4|collectMods → resolveStack|
|游击|small|L4→L5|true:false:false:false:false:reduction|0.19999999999999996|0.25|collectMods → resolveStack|
|游击|small|L5→L6|true:false:false:false:false:reduction|0.25|0.28|collectMods → resolveStack|
|游击|small|L6→L7|false:false:false:false:false:initiative|4|5|collectMods → resolveStack|
|游击|small|L7→L8|true:false:false:false:false:reduction|0.31000000000000005|0.3400000000000001|collectMods → resolveStack|
|游击|small|L8→L9|true:false:false:false:false:reduction|0.3400000000000001|0.37|collectMods → resolveStack|
|游击|small|L9→L10|false:false:false:false:false:initiative|5|6|collectMods → resolveStack|
|坚韧|small|L1→L2|control save bonus|3|4|controlBonus / pushPreview|
|坚韧|small|L2→L3|control save bonus|4|5|controlBonus / pushPreview|
|坚韧|small|L3→L4|blocks legal push force3|0|1|controlBonus / pushPreview|
|坚韧|small|L4→L5|control save bonus|5|6|controlBonus / pushPreview|
|坚韧|small|L5→L6|control save bonus|6|7|controlBonus / pushPreview|
|坚韧|small|L6→L7|control save bonus|7|8|controlBonus / pushPreview|
|坚韧|small|L7→L8|control save bonus|8|9|controlBonus / pushPreview|
|坚韧|small|L8→L9|control save bonus|9|10|controlBonus / pushPreview|
|坚韧|small|L9→L10|control save bonus|10|11|controlBonus / pushPreview|
|身法|small|L1→L2|terrain cost|-1.8|-1.6|tileCost / formationMarchCost|
|身法|small|L2→L3|terrain cost|-1.6|-1.4|tileCost / formationMarchCost|
|身法|small|L3→L4|terrain cost|-1.4|-1.2|tileCost / formationMarchCost|
|身法|small|L4→L5|terrain cost|-1.2|-1|tileCost / formationMarchCost|
|身法|small|L5→L6|initiative:initiative|2|3|collectMods → resolveStack|
|身法|small|L6→L7|initiative:initiative|3|4|collectMods → resolveStack|
|身法|small|L7→L8|mobility|3|4|collectMods → resolveStack|
|身法|small|L8→L9|initiative:initiative|4|5|collectMods → resolveStack|
|身法|small|L9→L10|mobility|4|5|collectMods → resolveStack|
|工兵|small|L1→L2|actual structure damage|9562|10431|weaponBreachBudget|
|工兵|small|L2→L3|actual structure damage|10431|11300|weaponBreachBudget|
|工兵|small|L3→L4|actual structure damage|11300|12169|weaponBreachBudget|
|工兵|small|L4→L5|actual structure damage|12169|13039|weaponBreachBudget|
|工兵|small|L5→L6|actual structure damage|13039|13908|weaponBreachBudget|
|工兵|small|L6→L7|actual structure damage|13908|14777|weaponBreachBudget|
|工兵|small|L7→L8|actual structure damage|14777|15646|weaponBreachBudget|
|工兵|small|L8→L9|actual structure damage|15646|16516|weaponBreachBudget|
|工兵|small|L9→L10|actual structure damage|16516|17385|weaponBreachBudget|
|近战特化|small|L1→L2|false:false:false:false:false:damage|1|1.025|collectMods → resolveStack|
|近战特化|small|L2→L3|false:false:false:false:false:damage|1.025|1.05|collectMods → resolveStack|
|近战特化|small|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|近战特化|small|L4→L5|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|近战特化|small|L5→L6|false:false:false:false:false:damage|1.15|1.2|collectMods → resolveStack|
|近战特化|small|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|近战特化|small|L7→L8|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|近战特化|small|L8→L9|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|近战特化|small|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|射击专家|small|L1→L2|shot:true:1:0:attack|7|8|previewAttack|
|射击专家|small|L2→L3|shot:false:9:0:attack|9|10|previewAttack|
|射击专家|small|L3→L4|shot:false:1:0:attack|10|11|previewAttack|
|射击专家|small|L4→L5|shot:true:1:0:attack|8|9|previewAttack|
|射击专家|small|L5→L6|shot:false:1:2:target defense|-21|-20|previewAttack|
|射击专家|small|L6→L7|shot:false:1:0:attack|11|12|previewAttack|
|射击专家|small|L7→L8|shot:false:1:2:target defense|-20|-19|previewAttack|
|射击专家|small|L8→L9|shot:false:1:0:attack|12|13|previewAttack|
|射击专家|small|L9→L10|shot:true:1:0:attack|11|12|previewAttack|
|冲锋强化|small|L1→L2|false:true:false:false:false:attack|0|1|collectMods → resolveStack|
|冲锋强化|small|L2→L3|false:true:false:true:false:attack|1|2|collectMods → resolveStack|
|冲锋强化|small|L3→L4|false:true:false:false:false:attack|1|2|collectMods → resolveStack|
|冲锋强化|small|L4→L5|false:true:false:false:false:attack|2|3|collectMods → resolveStack|
|冲锋强化|small|L5→L6|false:true:false:false:false:damage|1|1.05|collectMods → resolveStack|
|冲锋强化|small|L6→L7|false:true:false:false:false:attack|3|4|collectMods → resolveStack|
|冲锋强化|small|L7→L8|false:true:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|冲锋强化|small|L8→L9|false:true:false:false:false:attack|4|5|collectMods → resolveStack|
|冲锋强化|small|L9→L10|false:true:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|狂暴|small|L1→L2|true:false:false:false:false:attack|-2|-1|collectMods → resolveStack|
|狂暴|small|L2→L3|false:false:false:false:true:attack|-2|-1|collectMods → resolveStack|
|狂暴|small|L3→L4|false:false:false:false:false:attack|-1|0|collectMods → resolveStack|
|狂暴|small|L4→L5|false:false:false:false:true:attack|-1|0|collectMods → resolveStack|
|狂暴|small|L5→L6|false:false:false:false:false:attack|0|1|collectMods → resolveStack|
|狂暴|small|L6→L7|false:false:false:false:false:damage|1|1.03|collectMods → resolveStack|
|狂暴|small|L7→L8|false:false:false:false:false:damage|1.03|1.06|collectMods → resolveStack|
|狂暴|small|L8→L9|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|狂暴|small|L9→L10|false:false:false:false:false:damage|1.06|1.1|collectMods → resolveStack|
|对空|small|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|对空|small|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|对空|small|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|对空|small|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|对空|small|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|对空|small|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|对空|small|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|对空|small|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|对空|small|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|潜伏|small|L1→L2|opponent L0, distance4|0|1|canSpot|
|潜伏|small|L2→L3|opponent L2, distance4|0|1|canSpot|
|潜伏|small|L3→L4|opponent L0, distance3|0|1|canSpot|
|潜伏|small|L4→L5|opponent L2, distance3|0|1|canSpot|
|潜伏|small|L5→L6|opponent L0, distance2|0|1|canSpot|
|潜伏|small|L6→L7|opponent L2, distance2|0|1|canSpot|
|潜伏|small|L7→L8|opponent L3, distance2|0|1|canSpot|
|潜伏|small|L8→L9|opponent L4, distance2|0|1|canSpot|
|潜伏|small|L9→L10|opponent L5, distance2|0|1|canSpot|
|侦察|small|L1→L2|opponent L2, distance4|0|1|canSpot|
|侦察|small|L2→L3|opponent L0, distance5|0|1|canSpot|
|侦察|small|L3→L4|opponent L2, distance5|0|1|canSpot|
|侦察|small|L4→L5|opponent L0, distance6|0|1|canSpot|
|侦察|small|L5→L6|opponent L2, distance6|0|1|canSpot|
|侦察|small|L6→L7|opponent L0, distance7|0|1|canSpot|
|侦察|small|L7→L8|opponent L2, distance7|0|1|canSpot|
|侦察|small|L8→L9|opponent L3, distance7|0|1|canSpot|
|侦察|small|L9→L10|opponent L4, distance7|0|1|canSpot|
|林地专精|mass|L1→L2|terrain movement cost|-2|-1.75|tileCost / formationMarchCost|
|林地专精|mass|L2→L3|terrain movement cost|-1.75|-1.5|tileCost / formationMarchCost|
|林地专精|mass|L3→L4|terrain movement cost|-1.5|-1.25|tileCost / formationMarchCost|
|林地专精|mass|L4→L5|terrain movement cost|-1.25|-1|tileCost / formationMarchCost|
|林地专精|mass|L5→L6|forest:false:false:defense|0|1|collectMods → resolveStack|
|林地专精|mass|L6→L7|forest:false:false:attack|0|1|collectMods → resolveStack|
|林地专精|mass|L7→L8|legal terrain concealment|0|1|collectMods → resolveStack|
|林地专精|mass|L8→L9|forest:false:false:defense|1|2|collectMods → resolveStack|
|林地专精|mass|L9→L10|forest:false:false:attack|1|2|collectMods → resolveStack|
|山地专精|mass|L1→L2|terrain movement cost|-2|-1.75|tileCost / formationMarchCost|
|山地专精|mass|L2→L3|terrain movement cost|-1.75|-1.5|tileCost / formationMarchCost|
|山地专精|mass|L3→L4|terrain movement cost|-1.5|-1.25|tileCost / formationMarchCost|
|山地专精|mass|L4→L5|terrain movement cost|-1.25|-1|tileCost / formationMarchCost|
|山地专精|mass|L5→L6|hill:false:false:defense|1|2|collectMods → resolveStack|
|山地专精|mass|L6→L7|hill:false:false:attack|0|1|collectMods → resolveStack|
|山地专精|mass|L7→L8|legal terrain concealment|0|1|collectMods → resolveStack|
|山地专精|mass|L8→L9|hill:false:false:defense|2|3|collectMods → resolveStack|
|山地专精|mass|L9→L10|hill:false:false:attack|1|2|collectMods → resolveStack|
|夜战专精|mass|L1→L2|night:attack|-2|-1|collectMods → resolveStack|
|夜战专精|mass|L2→L3|night visible:4|0|1|collectMods → resolveStack|
|夜战专精|mass|L3→L4|night mobility|2|3|collectMods → resolveStack|
|夜战专精|mass|L4→L5|night:attack|-1|0|collectMods → resolveStack|
|夜战专精|mass|L5→L6|night visible:5|0|1|collectMods → resolveStack|
|夜战专精|mass|L6→L7|night:attack|0|1|collectMods → resolveStack|
|夜战专精|mass|L7→L8|night visible:6|0|1|collectMods → resolveStack|
|夜战专精|mass|L8→L9|night:defense|0|1|collectMods → resolveStack|
|夜战专精|mass|L9→L10|night:attack|1|2|collectMods → resolveStack|
|平原专精|mass|L1→L2|plains mobility|3|4|collectMods → resolveStack|
|平原专精|mass|L2→L3|open:false:false:initiative|3|4|collectMods → resolveStack|
|平原专精|mass|L3→L4|open:false:true:attack|0|1|collectMods → resolveStack|
|平原专精|mass|L4→L5|open:false:false:attack|0|1|collectMods → resolveStack|
|平原专精|mass|L5→L6|open:false:false:defense|0|1|collectMods → resolveStack|
|平原专精|mass|L6→L7|open:false:false:initiative|4|5|collectMods → resolveStack|
|平原专精|mass|L7→L8|open:false:true:attack|1|2|collectMods → resolveStack|
|平原专精|mass|L8→L9|plains mobility|4|5|collectMods → resolveStack|
|平原专精|mass|L9→L10|open:false:false:attack|1|2|collectMods → resolveStack|
|巷战专精|mass|L1→L2|street:false:false:attack|0|1|collectMods → resolveStack|
|巷战专精|mass|L2→L3|street:false:false:defense|1|2|collectMods → resolveStack|
|巷战专精|mass|L3→L4|street:true:false:attack|0|1|collectMods → resolveStack|
|巷战专精|mass|L4→L5|urban long shot:attack|0|1|collectMods → resolveStack|
|巷战专精|mass|L5→L6|street:false:false:initiative|2|3|collectMods → resolveStack|
|巷战专精|mass|L6→L7|street:false:false:defense|2|3|collectMods → resolveStack|
|巷战专精|mass|L7→L8|street:false:false:attack|1|2|collectMods → resolveStack|
|巷战专精|mass|L8→L9|urban concealment|0|1|collectMods → resolveStack|
|巷战专精|mass|L9→L10|street:true:false:attack|1|2|collectMods → resolveStack|
|守护|mass|L1→L2|false:false:false:false:false:reduction|0.050000000000000044|0.09999999999999998|collectMods → resolveStack|
|守护|mass|L2→L3|false:false:false:false:false:reduction|0.09999999999999998|0.15000000000000002|collectMods → resolveStack|
|守护|mass|L3→L4|false:false:false:false:false:reduction|0.15000000000000002|0.19999999999999996|collectMods → resolveStack|
|守护|mass|L4→L5|false:false:false:false:false:reduction|0.19999999999999996|0.25|collectMods → resolveStack|
|守护|mass|L5→L6|false:false:false:false:false:reduction|0.25|0.30000000000000004|collectMods → resolveStack|
|守护|mass|L6→L7|false:false:false:false:false:reduction|0.30000000000000004|0.35|collectMods → resolveStack|
|守护|mass|L7→L8|false:false:false:false:false:reduction|0.35|0.4|collectMods → resolveStack|
|守护|mass|L8→L9|false:false:false:false:false:reduction|0.4|0.42500000000000004|collectMods → resolveStack|
|守护|mass|L9→L10|false:false:false:false:false:reduction|0.42500000000000004|0.44999999999999996|collectMods → resolveStack|
|吸血|mass|L1→L2|actual life loss converted|50|100|lifestealAmount|
|吸血|mass|L2→L3|actual life loss converted|100|150|lifestealAmount|
|吸血|mass|L3→L4|actual life loss converted|150|200|lifestealAmount|
|吸血|mass|L4→L5|actual life loss converted|200|250|lifestealAmount|
|吸血|mass|L5→L6|actual life loss converted|250|280|lifestealAmount|
|吸血|mass|L6→L7|actual life loss converted|280|310|lifestealAmount|
|吸血|mass|L7→L8|actual life loss converted|310|340|lifestealAmount|
|吸血|mass|L8→L9|actual life loss converted|340|370|lifestealAmount|
|吸血|mass|L9→L10|actual life loss converted|370|400|lifestealAmount|
|偷袭|mass|L1→L2|false:false:false:false:false:damage|1.1|1.2|collectMods → resolveStack|
|偷袭|mass|L2→L3|false:false:false:false:false:damage|1.2|1.3|collectMods → resolveStack|
|偷袭|mass|L3→L4|false:false:false:false:false:damage|1.3|1.4|collectMods → resolveStack|
|偷袭|mass|L4→L5|false:false:false:false:false:damage|1.4|1.5|collectMods → resolveStack|
|偷袭|mass|L5→L6|false:false:false:false:false:damage|1.5|1.55|collectMods → resolveStack|
|偷袭|mass|L6→L7|false:false:false:false:false:damage|1.55|1.6|collectMods → resolveStack|
|偷袭|mass|L7→L8|false:false:false:false:false:damage|1.6|1.65|collectMods → resolveStack|
|偷袭|mass|L8→L9|false:false:false:false:false:damage|1.65|1.7|collectMods → resolveStack|
|偷袭|mass|L9→L10|false:false:false:false:false:damage|1.7|1.75|collectMods → resolveStack|
|耐力训练|mass|L1→L2|actual fatigue ledger|-0.45|-0.4|collectMods → resolveStack|
|耐力训练|mass|L2→L3|actual fatigue ledger|-0.4|-0.35|collectMods → resolveStack|
|耐力训练|mass|L3→L4|actual fatigue ledger|-0.35|-0.3|collectMods → resolveStack|
|耐力训练|mass|L4→L5|actual fatigue ledger|-0.3|-0.25|collectMods → resolveStack|
|耐力训练|mass|L5→L6|actual fatigue ledger|-0.25|-0.235|collectMods → resolveStack|
|耐力训练|mass|L6→L7|actual fatigue ledger|-0.235|-0.22|collectMods → resolveStack|
|耐力训练|mass|L7→L8|actual fatigue ledger|-0.22|-0.205|collectMods → resolveStack|
|耐力训练|mass|L8→L9|actual fatigue ledger|-0.205|-0.19|collectMods → resolveStack|
|耐力训练|mass|L9→L10|actual fatigue ledger|-0.19|-0.175|collectMods → resolveStack|
|践踏|mass|L1→L2|false:true:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|践踏|mass|L2→L3|false:true:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|践踏|mass|L3→L4|false:true:false:false:false:damage|1.15|1.2|collectMods → resolveStack|
|践踏|mass|L4→L5|false:true:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|践踏|mass|L5→L6|false:true:false:false:false:damage|1.25|1.28|collectMods → resolveStack|
|践踏|mass|L6→L7|false:true:false:false:false:damage|1.28|1.31|collectMods → resolveStack|
|践踏|mass|L7→L8|false:true:false:false:false:damage|1.31|1.34|collectMods → resolveStack|
|践踏|mass|L8→L9|false:true:false:false:false:damage|1.34|1.37|collectMods → resolveStack|
|践踏|mass|L9→L10|false:true:false:false:false:damage|1.37|1.4|collectMods → resolveStack|
|盾墙|mass|L1→L2|true:false:false:false:false:reduction|0.09999999999999998|0.17999999999999994|collectMods → resolveStack|
|盾墙|mass|L2→L3|true:false:false:false:false:reduction|0.17999999999999994|0.26|collectMods → resolveStack|
|盾墙|mass|L3→L4|true:false:false:false:false:reduction|0.26|0.33000000000000007|collectMods → resolveStack|
|盾墙|mass|L4→L5|true:false:false:false:false:reduction|0.33000000000000007|0.4|collectMods → resolveStack|
|盾墙|mass|L5→L6|true:false:false:false:false:reduction|0.4|0.42999999999999994|collectMods → resolveStack|
|盾墙|mass|L6→L7|true:false:false:false:false:reduction|0.42999999999999994|0.45999999999999996|collectMods → resolveStack|
|盾墙|mass|L7→L8|true:false:false:false:false:reduction|0.45999999999999996|0.49|collectMods → resolveStack|
|盾墙|mass|L8→L9|true:false:false:false:false:reduction|0.49|0.52|collectMods → resolveStack|
|盾墙|mass|L9→L10|true:false:false:false:false:reduction|0.52|0.55|collectMods → resolveStack|
|破甲|mass|L1→L2|real kinetic penetration|22.2|22.4|penetrationContext|
|破甲|mass|L2→L3|real kinetic penetration|22.4|22.6|penetrationContext|
|破甲|mass|L3→L4|real kinetic penetration|22.6|22.8|penetrationContext|
|破甲|mass|L4→L5|real kinetic penetration|22.8|23|penetrationContext|
|破甲|mass|L5→L6|real kinetic penetration|23|23.25|penetrationContext|
|破甲|mass|L6→L7|real kinetic penetration|23.25|23.5|penetrationContext|
|破甲|mass|L7→L8|real kinetic penetration|23.5|24|penetrationContext|
|破甲|mass|L8→L9|real kinetic penetration|24|24.25|penetrationContext|
|破甲|mass|L9→L10|real kinetic penetration|24.25|24.5|penetrationContext|
|克制步兵|mass|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|克制步兵|mass|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|克制步兵|mass|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|克制步兵|mass|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|克制步兵|mass|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|克制步兵|mass|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|克制步兵|mass|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|克制步兵|mass|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|克制步兵|mass|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|克制大型|mass|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|克制大型|mass|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|克制大型|mass|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|克制大型|mass|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|克制大型|mass|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|克制大型|mass|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|克制大型|mass|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|克制大型|mass|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|克制大型|mass|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|顽固|mass|L1→L2|effective morale|28|31|moraleProfile|
|顽固|mass|L2→L3|effective morale|31|34|moraleProfile|
|顽固|mass|L3→L4|effective morale|34|37|moraleProfile|
|顽固|mass|L4→L5|effective morale|37|40|moraleProfile|
|顽固|mass|L5→L6|effective morale|40|42|moraleProfile|
|顽固|mass|L6→L7|effective morale|42|44|moraleProfile|
|顽固|mass|L7→L8|effective morale|44|46|moraleProfile|
|顽固|mass|L8→L9|effective morale|46|48|moraleProfile|
|顽固|mass|L9→L10|effective morale|48|50|moraleProfile|
|统率|mass|L1→L2|effective morale|42|44|moraleProfile|
|统率|mass|L2→L3|effective morale|44|46|moraleProfile|
|统率|mass|L3→L4|effective morale|46|48|moraleProfile|
|统率|mass|L4→L5|effective morale|48|50|moraleProfile|
|统率|mass|L5→L6|effective morale|50|52|moraleProfile|
|统率|mass|L6→L7|effective morale|52|54|moraleProfile|
|统率|mass|L7→L8|effective morale|54|56|moraleProfile|
|统率|mass|L8→L9|effective morale|56|58|moraleProfile|
|统率|mass|L9→L10|effective morale|58|60|moraleProfile|
|再生|mass|L1→L2|three legal periods including saved remainder|2.25|4.5|settleRegeneration(regenerationAmount)|
|再生|mass|L2→L3|three legal periods including saved remainder|4.5|6.75|settleRegeneration(regenerationAmount)|
|再生|mass|L3→L4|three legal periods including saved remainder|6.75|7.875|settleRegeneration(regenerationAmount)|
|再生|mass|L4→L5|three legal periods including saved remainder|7.875|9|settleRegeneration(regenerationAmount)|
|再生|mass|L5→L6|three legal periods including saved remainder|9|10.125|settleRegeneration(regenerationAmount)|
|再生|mass|L6→L7|three legal periods including saved remainder|10.125|21.5667|settleRegeneration(regenerationAmount)|
|再生|mass|L7→L8|three legal periods including saved remainder|21.5667|51.0252|settleRegeneration(regenerationAmount)|
|再生|mass|L8→L9|three legal periods including saved remainder|51.0252|153.7044|settleRegeneration(regenerationAmount)|
|再生|mass|L9→L10|three legal periods including saved remainder|153.7044|555.492|settleRegeneration(regenerationAmount)|
|医护|mass|L1→L2|actual healing budget|1050|1100|healingYield|
|医护|mass|L2→L3|actual healing budget|1100|1150|healingYield|
|医护|mass|L3→L4|actual healing budget|1150|1200|healingYield|
|医护|mass|L4→L5|actual healing budget|1200|1250|healingYield|
|医护|mass|L5→L6|actual healing budget|1250|1280|healingYield|
|医护|mass|L6→L7|actual healing budget|1280|1310|healingYield|
|医护|mass|L7→L8|actual healing budget|1310|1340|healingYield|
|医护|mass|L8→L9|actual healing budget|1340|1370|healingYield|
|医护|mass|L9→L10|actual healing budget|1370|1400|healingYield|
|淬毒|mass|L1→L2|frozen DOT expectation at roll4|20|40|weaponConditions → conditionDamage|
|淬毒|mass|L2→L3|frozen DOT expectation at roll4|40|60|weaponConditions → conditionDamage|
|淬毒|mass|L3→L4|frozen DOT expectation at roll4|60|70|weaponConditions → conditionDamage|
|淬毒|mass|L4→L5|frozen DOT expectation at roll4|70|80|weaponConditions → conditionDamage|
|淬毒|mass|L5→L6|frozen DOT expectation at roll4|80|90|weaponConditions → conditionDamage|
|淬毒|mass|L6→L7|frozen DOT expectation at roll4|90|105|weaponConditions → conditionDamage|
|淬毒|mass|L7→L8|frozen DOT expectation at roll4|105|120|weaponConditions → conditionDamage|
|淬毒|mass|L8→L9|frozen DOT expectation at roll4|120|140|weaponConditions → conditionDamage|
|淬毒|mass|L9→L10|frozen DOT expectation at roll4|140|160|weaponConditions → conditionDamage|
|恐惧|mass|L1→L2|effective morale|-38|-37|moraleProfile|
|恐惧|mass|L2→L3|effective morale|-37|-35|moraleProfile|
|恐惧|mass|L3→L4|effective morale|-35|-34|moraleProfile|
|恐惧|mass|L4→L5|effective morale|-34|-32|moraleProfile|
|恐惧|mass|L5→L6|effective morale|-32|-30|moraleProfile|
|恐惧|mass|L6→L7|effective morale|-30|-28|moraleProfile|
|恐惧|mass|L7→L8|effective morale|-28|-25|moraleProfile|
|恐惧|mass|L8→L9|effective morale|-25|-23|moraleProfile|
|恐惧|mass|L9→L10|effective morale|-23|-22|moraleProfile|
|工事|mass|L1→L2|true:false:false:false:false:reduction|0.09999999999999998|0.15000000000000002|collectMods → resolveStack|
|工事|mass|L2→L3|false:false:false:false:false:defense|1|2|collectMods → resolveStack|
|工事|mass|L3→L4|true:false:false:false:false:reduction|0.19999999999999996|0.25|collectMods → resolveStack|
|工事|mass|L4→L5|false:false:false:false:false:defense|2|3|collectMods → resolveStack|
|工事|mass|L5→L6|true:false:false:false:false:reduction|0.30000000000000004|0.33000000000000007|collectMods → resolveStack|
|工事|mass|L6→L7|true:false:false:false:false:reduction|0.33000000000000007|0.36|collectMods → resolveStack|
|工事|mass|L7→L8|false:false:false:false:false:defense|3|4|collectMods → resolveStack|
|工事|mass|L8→L9|true:false:false:false:false:reduction|0.39|0.41999999999999993|collectMods → resolveStack|
|工事|mass|L9→L10|false:false:false:false:false:defense|4|5|collectMods → resolveStack|
|拒马|mass|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|拒马|mass|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|拒马|mass|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|拒马|mass|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|拒马|mass|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|拒马|mass|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|拒马|mass|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|拒马|mass|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|拒马|mass|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|散兵|mass|L1→L2|false:false:false:false:false:reduction|0.09999999999999998|0.19999999999999996|collectMods → resolveStack|
|散兵|mass|L2→L3|false:false:false:false:false:reduction|0.19999999999999996|0.30000000000000004|collectMods → resolveStack|
|散兵|mass|L3→L4|false:false:false:false:false:reduction|0.30000000000000004|0.4|collectMods → resolveStack|
|散兵|mass|L4→L5|false:false:false:false:false:reduction|0.4|0.5|collectMods → resolveStack|
|散兵|mass|L5→L6|false:false:false:false:false:reduction|0.5|0.53|collectMods → resolveStack|
|散兵|mass|L6→L7|false:false:false:false:false:reduction|0.53|0.56|collectMods → resolveStack|
|散兵|mass|L7→L8|false:false:false:false:false:reduction|0.56|0.59|collectMods → resolveStack|
|散兵|mass|L8→L9|false:false:false:false:false:reduction|0.59|0.62|collectMods → resolveStack|
|散兵|mass|L9→L10|false:false:false:false:false:reduction|0.62|0.65|collectMods → resolveStack|
|游击|mass|L1→L2|false:false:false:false:false:initiative|2|3|collectMods → resolveStack|
|游击|mass|L2→L3|true:false:false:false:false:reduction|0.09999999999999998|0.15000000000000002|collectMods → resolveStack|
|游击|mass|L3→L4|false:false:false:false:false:initiative|3|4|collectMods → resolveStack|
|游击|mass|L4→L5|true:false:false:false:false:reduction|0.19999999999999996|0.25|collectMods → resolveStack|
|游击|mass|L5→L6|true:false:false:false:false:reduction|0.25|0.28|collectMods → resolveStack|
|游击|mass|L6→L7|false:false:false:false:false:initiative|4|5|collectMods → resolveStack|
|游击|mass|L7→L8|true:false:false:false:false:reduction|0.31000000000000005|0.3400000000000001|collectMods → resolveStack|
|游击|mass|L8→L9|true:false:false:false:false:reduction|0.3400000000000001|0.37|collectMods → resolveStack|
|游击|mass|L9→L10|false:false:false:false:false:initiative|5|6|collectMods → resolveStack|
|坚韧|mass|L1→L2|control save bonus|3|4|controlBonus / pushPreview|
|坚韧|mass|L2→L3|control save bonus|4|5|controlBonus / pushPreview|
|坚韧|mass|L3→L4|blocks legal push force3|0|1|controlBonus / pushPreview|
|坚韧|mass|L4→L5|control save bonus|5|6|controlBonus / pushPreview|
|坚韧|mass|L5→L6|control save bonus|6|7|controlBonus / pushPreview|
|坚韧|mass|L6→L7|control save bonus|7|8|controlBonus / pushPreview|
|坚韧|mass|L7→L8|control save bonus|8|9|controlBonus / pushPreview|
|坚韧|mass|L8→L9|control save bonus|9|10|controlBonus / pushPreview|
|坚韧|mass|L9→L10|control save bonus|10|11|controlBonus / pushPreview|
|身法|mass|L1→L2|terrain cost|-1.8|-1.6|tileCost / formationMarchCost|
|身法|mass|L2→L3|terrain cost|-1.6|-1.4|tileCost / formationMarchCost|
|身法|mass|L3→L4|terrain cost|-1.4|-1.2|tileCost / formationMarchCost|
|身法|mass|L4→L5|terrain cost|-1.2|-1|tileCost / formationMarchCost|
|身法|mass|L5→L6|initiative:initiative|2|3|collectMods → resolveStack|
|身法|mass|L6→L7|initiative:initiative|3|4|collectMods → resolveStack|
|身法|mass|L7→L8|mobility|3|4|collectMods → resolveStack|
|身法|mass|L8→L9|initiative:initiative|4|5|collectMods → resolveStack|
|身法|mass|L9→L10|mobility|4|5|collectMods → resolveStack|
|工兵|mass|L1→L2|actual structure damage|28685|31293|weaponBreachBudget|
|工兵|mass|L2→L3|actual structure damage|31293|33900|weaponBreachBudget|
|工兵|mass|L3→L4|actual structure damage|33900|36508|weaponBreachBudget|
|工兵|mass|L4→L5|actual structure damage|36508|39116|weaponBreachBudget|
|工兵|mass|L5→L6|actual structure damage|39116|41723|weaponBreachBudget|
|工兵|mass|L6→L7|actual structure damage|41723|44331|weaponBreachBudget|
|工兵|mass|L7→L8|actual structure damage|44331|46939|weaponBreachBudget|
|工兵|mass|L8→L9|actual structure damage|46939|49547|weaponBreachBudget|
|工兵|mass|L9→L10|actual structure damage|49547|52154|weaponBreachBudget|
|近战特化|mass|L1→L2|false:false:false:false:false:damage|1|1.025|collectMods → resolveStack|
|近战特化|mass|L2→L3|false:false:false:false:false:damage|1.025|1.05|collectMods → resolveStack|
|近战特化|mass|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|近战特化|mass|L4→L5|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|近战特化|mass|L5→L6|false:false:false:false:false:damage|1.15|1.2|collectMods → resolveStack|
|近战特化|mass|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|近战特化|mass|L7→L8|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|近战特化|mass|L8→L9|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|近战特化|mass|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|射击专家|mass|L1→L2|shot:true:1:0:attack|7|8|previewAttack|
|射击专家|mass|L2→L3|shot:false:4:0:attack|9|10|previewAttack|
|射击专家|mass|L3→L4|shot:false:1:0:attack|10|11|previewAttack|
|射击专家|mass|L4→L5|shot:true:1:0:attack|8|9|previewAttack|
|射击专家|mass|L5→L6|shot:false:1:2:target defense|-21|-20|previewAttack|
|射击专家|mass|L6→L7|shot:false:1:0:attack|11|12|previewAttack|
|射击专家|mass|L7→L8|shot:false:1:2:target defense|-20|-19|previewAttack|
|射击专家|mass|L8→L9|shot:false:1:0:attack|12|13|previewAttack|
|射击专家|mass|L9→L10|shot:true:1:0:attack|11|12|previewAttack|
|冲锋强化|mass|L1→L2|false:true:false:false:false:attack|0|1|collectMods → resolveStack|
|冲锋强化|mass|L2→L3|false:true:false:true:false:attack|1|2|collectMods → resolveStack|
|冲锋强化|mass|L3→L4|false:true:false:false:false:attack|1|2|collectMods → resolveStack|
|冲锋强化|mass|L4→L5|false:true:false:false:false:attack|2|3|collectMods → resolveStack|
|冲锋强化|mass|L5→L6|false:true:false:false:false:damage|1|1.05|collectMods → resolveStack|
|冲锋强化|mass|L6→L7|false:true:false:false:false:attack|3|4|collectMods → resolveStack|
|冲锋强化|mass|L7→L8|false:true:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|冲锋强化|mass|L8→L9|false:true:false:false:false:attack|4|5|collectMods → resolveStack|
|冲锋强化|mass|L9→L10|false:true:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|狂暴|mass|L1→L2|true:false:false:false:false:attack|-2|-1|collectMods → resolveStack|
|狂暴|mass|L2→L3|false:false:false:false:true:attack|-2|-1|collectMods → resolveStack|
|狂暴|mass|L3→L4|false:false:false:false:false:attack|-1|0|collectMods → resolveStack|
|狂暴|mass|L4→L5|false:false:false:false:true:attack|-1|0|collectMods → resolveStack|
|狂暴|mass|L5→L6|false:false:false:false:false:attack|0|1|collectMods → resolveStack|
|狂暴|mass|L6→L7|false:false:false:false:false:damage|1|1.03|collectMods → resolveStack|
|狂暴|mass|L7→L8|false:false:false:false:false:damage|1.03|1.06|collectMods → resolveStack|
|狂暴|mass|L8→L9|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|狂暴|mass|L9→L10|false:false:false:false:false:damage|1.06|1.1|collectMods → resolveStack|
|对空|mass|L1→L2|false:false:false:false:false:damage|1.05|1.1|collectMods → resolveStack|
|对空|mass|L2→L3|false:false:false:false:false:damage|1.1|1.15|collectMods → resolveStack|
|对空|mass|L3→L4|false:false:false:false:false:attack|1|2|collectMods → resolveStack|
|对空|mass|L4→L5|false:false:false:false:false:damage|1.2|1.25|collectMods → resolveStack|
|对空|mass|L5→L6|false:false:false:false:false:damage|1.25|1.3|collectMods → resolveStack|
|对空|mass|L6→L7|false:false:false:false:false:attack|2|3|collectMods → resolveStack|
|对空|mass|L7→L8|false:false:false:false:false:damage|1.35|1.4|collectMods → resolveStack|
|对空|mass|L8→L9|false:false:false:false:false:damage|1.4|1.45|collectMods → resolveStack|
|对空|mass|L9→L10|false:false:false:false:false:attack|3|4|collectMods → resolveStack|
|潜伏|mass|L1→L2|opponent L0, distance2|0|1|canSpot|
|潜伏|mass|L2→L3|opponent L2, distance2|0|1|canSpot|
|潜伏|mass|L3→L4|opponent L3, distance2|0|1|canSpot|
|潜伏|mass|L4→L5|opponent L4, distance2|0|1|canSpot|
|潜伏|mass|L5→L6|opponent L5, distance2|0|1|canSpot|
|潜伏|mass|L6→L7|opponent L6, distance2|0|1|canSpot|
|潜伏|mass|L7→L8|opponent L7, distance2|0|1|canSpot|
|潜伏|mass|L8→L9|opponent L8, distance2|0|1|canSpot|
|潜伏|mass|L9→L10|opponent L9, distance2|0|1|canSpot|
|侦察|mass|L1→L2|opponent L2, distance2|0|1|canSpot|
|侦察|mass|L2→L3|opponent L3, distance2|0|1|canSpot|
|侦察|mass|L3→L4|opponent L4, distance2|0|1|canSpot|
|侦察|mass|L4→L5|opponent L0, distance3|0|1|canSpot|
|侦察|mass|L5→L6|opponent L2, distance3|0|1|canSpot|
|侦察|mass|L6→L7|opponent L3, distance3|0|1|canSpot|
|侦察|mass|L7→L8|opponent L4, distance3|0|1|canSpot|
|侦察|mass|L8→L9|opponent L5, distance3|0|1|canSpot|
|侦察|mass|L9→L10|opponent L6, distance3|0|1|canSpot|

审计失败：无。
