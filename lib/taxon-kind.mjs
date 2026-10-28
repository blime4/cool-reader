export const KINDS=['plant','animal','bird','other'];
export const kingdomGroup=kind=>kind==='bird'?'animal':kind??'plant';
export function inferKind(taxon){
  const names=new Set([taxon.iconic_taxon_name,...(taxon.ancestors??[]).map(item=>item.name)]);
  const ids=new Set([taxon.iconic_taxon_id,...(taxon.ancestor_ids??[]),...(taxon.ancestors??[]).map(item=>item.id)].map(String));
  if(names.has('Aves')||ids.has('3'))return 'bird';
  if(names.has('Plantae')||ids.has('47126'))return 'plant';
  if(ids.has('1')||['Animalia','Mammalia','Reptilia','Amphibia','Actinopterygii','Mollusca','Insecta','Arachnida'].some(name=>names.has(name)))return 'animal';
  return 'other';
}
export function matchesKind(kind,scope){return scope==='all'||kind===scope||(scope==='animal'&&kind==='bird');}
