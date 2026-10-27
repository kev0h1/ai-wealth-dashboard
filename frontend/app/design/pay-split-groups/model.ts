import type { MoneyShape } from '@/lib/api';
export type Kind = 'commitment' | 'discretionary' | 'movement';
export type Group = 'fixed' | 'moved' | 'free' | 'excluded';
export const GROUPS: Group[] = ['fixed','moved','free','excluded'];
export const LABELS: Record<Group,string> = {fixed:'Fixed',moved:'Moved',free:'Free',excluded:'Not counted'};
export const KIND_GROUP:Record<Kind,Group> = {commitment:'fixed',discretionary:'free',movement:'moved'};
export const KIND_LABEL:Record<Kind,string> = {commitment:'Fixed',discretionary:'Free',movement:'Moved'};
export type Category = {name:string;kind:Kind|null;amount:number;custom?:boolean;evidence?:boolean;reason?:string;excluded?:number};
export const CATEGORIES:Category[] = [
 {name:'Bills',kind:'commitment',amount:480},{name:'Mortgage',kind:'commitment',amount:0},{name:'Rent',kind:'commitment',amount:820},{name:'Car finance',kind:'commitment',amount:0},{name:'Groceries',kind:'commitment',amount:180},{name:'Transport',kind:'commitment',amount:70},{name:'Software',kind:'commitment',amount:30},
 {name:'Eating Out',kind:'discretionary',amount:120},{name:'Entertainment',kind:'discretionary',amount:40},{name:'Shopping',kind:'discretionary',amount:160},{name:'Subscriptions',kind:'discretionary',amount:45},{name:'Health',kind:'discretionary',amount:70},{name:'Beauty',kind:'discretionary',amount:0},{name:'Travel',kind:'discretionary',amount:0},{name:'Cash',kind:'discretionary',amount:20},{name:'Charity',kind:'discretionary',amount:15},{name:'Other',kind:'discretionary',amount:0},
 {name:'Savings',kind:'movement',amount:200,reason:'Savings are money moved, not purchases.'},{name:'Investment',kind:'movement',amount:100,reason:'Investing is money moved, not purchases.'},
 {name:'Business',kind:'discretionary',amount:45,custom:true},{name:'Padel',kind:'discretionary',amount:60,custom:true},{name:'Childcare',kind:'commitment',amount:90,custom:true},
 {name:'Debt',kind:null,amount:0,excluded:180,reason:'Card repayments are left out because the purchases already count. Loan repayments count in Fixed.'},
 {name:'Transfer',kind:null,amount:0,excluded:70,reason:'Unmatched transfers stay outside this split. Confirmed moves between your accounts count in Moved.'},
 {name:'Income',kind:null,amount:0,excluded:3200,reason:'Income is the starting amount for the split, not spending.'},
];
export type Kinds=Record<string,Kind>;
export const DEFAULTS:Kinds=Object.fromEntries(CATEGORIES.filter(c=>c.kind).map(c=>[c.name,c.kind!])) as Kinds;
export const EXAMPLES=['standard','later-period','no-custom','many','loading','save-error','missing'] as const;
export type Example=typeof EXAMPLES[number];
export function categories(example:Example):Category[]{
 const rows=CATEGORIES.filter(c=>example!=='no-custom'||!c.custom).map(c=>({...c,amount:example==='later-period'&&c.name==='Business'?0:c.amount}));
 if(example==='many')for(let i=1;i<=16;i++)rows.push({name:i===1?'Family activities and weekend trips':`Personal category ${i}`,kind:'discretionary',amount:0,custom:true});
 return rows;
}
export function groupOf(c:Category,kinds:Kinds):Group{return c.kind?KIND_GROUP[kinds[c.name]??c.kind]:'excluded'}
export function permitted(c:Category):Kind[]{
 if(!c.kind||c.reason||c.name==='Other')return [];
 if(c.custom)return ['commitment','discretionary','movement'];
 return [];
}
export function shapeFor(rows:Category[],kinds:Kinds):MoneyShape{
 const totals={fixed:50,moved:320,free:0}; // loan repayment and confirmed own-account move; never editable category rules.
 const drivers:Record<'fixed'|'moved'|'free',{category:string|null;amount:number}[]>={fixed:[{category:'Loan repayments',amount:50}],moved:[{category:'Between your accounts',amount:320}],free:[]};
 for(const c of rows){const group=groupOf(c,kinds);if(group==='excluded'||!c.amount)continue;totals[group]+=c.amount;drivers[group].push({category:c.name,amount:c.amount});}
 const take_home=3200,total_out=totals.fixed+totals.moved+totals.free,left=Math.max(0,take_home-total_out),beyond=Math.max(0,total_out-take_home),base=Math.max(take_home,total_out);
 return {status:'ok',period:{start:'2026-08-28',end:'2026-09-24',label:'Sep'},take_home,total_out,overspent:beyond,beyond,beyond_source:null,jobs:[...(['fixed','moved','free'] as const).map(id=>({id,label:LABELS[id],amount:totals[id],share:totals[id]/base*100,categories:drivers[id].map(d=>d.category).filter(Boolean) as string[],drivers:drivers[id]})),{id:'left',label:'Left',amount:left,share:left/base*100,categories:[]}]} as MoneyShape;
}
