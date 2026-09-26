#!/usr/bin/env python3
"""Export shareable figures from the verified audit summary."""
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

OUT=Path(__file__).resolve().parents[1]/'docs/worldview-audit-20260926'
s=json.loads((OUT/'summary.json').read_text())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
colors=['#187a94','#c5792d']
labels=['Sword vs blunt\nUnarmored','Sword vs blunt\nHeavy armor','Rifle vs energy\nKinetic armor','Rifle vs energy\nThermal armor']
keys=['sword-blunt-unarmored','sword-blunt-heavy','rifle-energy-kinetic','rifle-energy-thermal']
fig,ax=plt.subplots(figsize=(10,5.6),layout='constrained')
y=np.arange(4)
for i,mode in enumerate(['small','mass']):
    rows=[next(x for x in s['armorControls'] if x['caseId']==key and x['mode']==mode) for key in keys]
    values=[100*x['aWins']/x['n'] for x in rows]
    bars=ax.barh(y+(i-.5)*.32,values,height=.28,label=['Small battle','Mass battle'][i],color=colors[i])
    for bar,value in zip(bars,values):
        ax.text(max(value,0)+1,bar.get_y()+bar.get_height()/2,f'{value:g}%',va='center',fontsize=10)
ax.set(yticks=y,yticklabels=labels,xlim=(0,112),xlabel='Left-hand weapon win rate (%)',title='Armor changes reverse weapon advantages')
ax.invert_yaxis();ax.axvline(50,color='#94a3b8',lw=.8,ls='--');fig.legend(loc='outside lower center',ncol=2)
fig.text(.5,-.10,'Fixed T5 / P3, human, open terrain, close start; 40 battles per bar (20 seed pairs).',ha='center',fontsize=9)
fig.savefig(OUT/'armor-controls.png',dpi=170,bbox_inches='tight');plt.close(fig)

fig,axes=plt.subplots(1,2,figsize=(11,5),layout='constrained',sharey=True)
definitions=['stun','root','disarm','silence','stun+disarm+silence']
for ax,mode in zip(axes,['small','mass']):
    vals=[]
    for d in definitions:
        x=next(x for x in s['policyUsage'] if x['mode']==mode and x['policy']=='skill-priority' and x['definition']=='generic:debuff:'+d)
        vals.append(100*x['usedUnitBattles']/x['equippedUnitBattles'])
    ax.barh(np.arange(5),vals,color=colors[0 if mode=='small' else 1],height=.55,label='Skill-priority')
    ax.scatter([0]*5,np.arange(5),marker='x',s=55,color='#9f1239',label='Default AI',zorder=5)
    for i,v in enumerate(vals):ax.text(v+1,i,f'{v:g}%',va='center',fontsize=10)
    ax.set(yticks=np.arange(5),yticklabels=['Stun','Root','Disarm','Silence','Combined control'],xlim=(-3,115),xlabel='Equipped unit-battles with a cast (%)',title=mode.title()+' battle')
    ax.invert_yaxis()
handles,legend_labels=axes[0].get_legend_handles_labels()
fig.legend(handles,legend_labels,loc='outside lower center',ncol=2)
fig.suptitle('Default AI never casts control skills in these diagnostic duels',fontsize=14)
fig.savefig(OUT/'control-usage.png',dpi=170,bbox_inches='tight');plt.close(fig)

fig,ax=plt.subplots(figsize=(9.2,5),layout='constrained')
names={'medieval':'Medieval','gunpowder':'Gunpowder','fantasy':'Fantasy','modern':'Modern','cyber':'Cyber','space':'Space'}
order=list(names)
for i,mode in enumerate(['small','mass']):
    values=[next(x['scorePct'] for x in s['crossWorld'] if x['family']=='cross-equal' and x['mode']==mode and x['world']==w) for w in order]
    ax.bar(np.arange(6)+(i-.5)*.35,values,width=.32,color=colors[i],label=['Small','Mass'][i])
ax.set(xticks=np.arange(6),xticklabels=[names[w] for w in order],ylim=(0,103),ylabel='Fixture score: (wins + 0.5 draws) / games (%)',title='Equal equipment level does not equal equal army cost')
ax.legend();ax.axhline(50,color='#94a3b8',lw=.8,ls='--')
fig.text(.5,-.04,'Authored templates; P3/P7, T5; 100 games per bar. Bodies, weapons and rosters differ.',ha='center',fontsize=9)
fig.savefig(OUT/'worldview-templates.png',dpi=170,bbox_inches='tight');plt.close(fig)
print('Rendered 3 figures')
