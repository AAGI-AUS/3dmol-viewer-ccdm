// Static score-table schema served by /api/scores/metrics. Kept in step with
// server.js — see the comments there for what each group and metric means.

export const SCORE_GROUPS = [
  { key: 'global',    label: 'Global confidence' },
  { key: 'interface', label: 'Interface quality' },
  { key: 'chains',    label: 'Per-chain & MSA depth' },
];

export const SCORE_METRICS = [
  { key: 'pTM',                   group: 'global',    label: 'pTM',                scale: 'unit',  better: 'high', desc: 'Predicted TM-score of the whole complex' },
  { key: 'ipTM',                  group: 'global',    label: 'ipTM',               scale: 'unit',  better: 'high', desc: 'Interface predicted TM-score' },
  { key: 'composite',             group: 'global',    label: '0.8·ipTM + 0.2·pTM', scale: 'unit',  better: 'high', desc: 'AlphaFold ranking score — the usual headline number' },
  { key: 'pdockq',                group: 'interface', label: 'pDockQ',             scale: 'unit',  better: 'high', desc: 'Predicted DockQ score for the interface' },
  { key: 'pdockq2_A',             group: 'interface', label: 'pDockQ2',            sub: 'effector (A)',      scale: 'unit',  better: 'high', desc: 'pDockQ2 computed on chain A, the effector' },
  { key: 'pdockq2_B',             group: 'interface', label: 'pDockQ2',            sub: 'target (B)',        scale: 'unit',  better: 'high', desc: 'pDockQ2 computed on chain B, the target' },
  { key: 'LIS',                   group: 'interface', label: 'LIS',                sub: 'best direction',    scale: 'unit',  better: 'high', desc: 'Local interaction score — the larger of the two directions (effector→target, target→effector)' },
  { key: 'LIS_pep_rec',           group: 'interface', label: 'LIS pep→rec',        sub: 'effector → target', scale: 'unit',  better: 'high', detail: true, desc: 'Local interaction score, effector onto target' },
  { key: 'LIS_rec_pep',           group: 'interface', label: 'LIS rec→pep',        sub: 'target → effector', scale: 'unit',  better: 'high', detail: true, desc: 'Local interaction score, target onto effector' },
  { key: 'ipSAE',                 group: 'interface', label: 'ipSAE',              sub: 'best direction',    scale: 'unit',  better: 'high', desc: 'Interface pairwise score — the larger of the two directions (A→B, B→A)' },
  { key: 'ipSAE_A_B',             group: 'interface', label: 'ipSAE A→B',          sub: 'effector → target', scale: 'unit',  better: 'high', detail: true, desc: 'Interface pairwise score, effector onto target' },
  { key: 'ipSAE_B_A',             group: 'interface', label: 'ipSAE B→A',          sub: 'target → effector', scale: 'unit',  better: 'high', detail: true, desc: 'Interface pairwise score, target onto effector' },
  { key: 'fraction_disorder',     group: 'chains',    label: 'Fraction disorder',  sub: 'lower is better', scale: 'unit',  better: 'low',  desc: 'Fraction of residues predicted disordered — lower is better' },
  { key: 'effector_pTM',          group: 'chains',    label: 'Effector pTM',       sub: 'chain A',  scale: 'unit',  better: 'high' },
  { key: 'msa_depth_effector',    group: 'chains',    label: 'MSA depth effector', sub: 'per method', scale: 'count', better: 'high', desc: 'Depth of the effector alignment: the non-gap depth where the method reports one, otherwise the unpaired depth' },
  { key: 'effector_unpaired_msa', group: 'chains',    label: 'Effector MSA depth', sub: 'unpaired', scale: 'count', better: 'high', detail: true },
  { key: 'effector_paired_msa',   group: 'chains',    label: 'Effector MSA depth', sub: 'paired',   scale: 'count', better: 'high', detail: true },
  { key: 'effector_msa_nongap',   group: 'chains',    label: 'Effector MSA depth', sub: 'non-gap',  scale: 'count', better: 'high', detail: true },
  { key: 'host_pTM',              group: 'chains',    label: 'Host pTM',           sub: 'chain B',  scale: 'unit',  better: 'high' },
  { key: 'msa_depth_host',        group: 'chains',    label: 'MSA depth host',     sub: 'per method', scale: 'count', better: 'high', desc: 'Depth of the host alignment: the non-gap depth where the method reports one, otherwise the unpaired depth' },
  { key: 'host_unpaired_msa',     group: 'chains',    label: 'Host MSA depth',     sub: 'unpaired', scale: 'count', better: 'high', detail: true },
  { key: 'host_paired_msa',       group: 'chains',    label: 'Host MSA depth',     sub: 'paired',   scale: 'count', better: 'high', detail: true },
  { key: 'host_msa_nongap',       group: 'chains',    label: 'Host MSA depth',     sub: 'non-gap',  scale: 'count', better: 'high', detail: true },
];

export const METHOD_LABELS = {
  af3: 'AlphaFold3',
  afm: 'AlphaFold-Multimer',
  boltz2: 'Boltz-2',
  chai: 'Chai-1',
  esmfold2: 'ESMFold2',
};
