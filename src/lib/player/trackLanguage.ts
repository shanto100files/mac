/** Display metadata as a language name; release titles are not language tags. */
export function trackLanguage(language?: string): string {
  const raw = language?.trim().replace(/_/g, '-').toLowerCase();
  if (!raw || ['und', 'ext', 'unknown'].includes(raw)) return 'Unknown language';
  if (raw === 'mul') return 'Multiple languages';
  const aliases: Record<string, string> = {
    eng:'en', hin:'hi', tam:'ta', tel:'te', mal:'ml', kan:'kn', ben:'bn', mar:'mr', sin:'si',
    fra:'fr', fre:'fr', deu:'de', ger:'de', spa:'es', por:'pt', jpn:'ja', kor:'ko', zho:'zh', chi:'zh', ara:'ar', rus:'ru', ita:'it',
  };
  const parts = raw.split('-');
  parts[0] = aliases[parts[0]] || parts[0];
  try {return new Intl.DisplayNames(['en'], {type:'language'}).of(parts.join('-')) || raw.toUpperCase();}
  catch {return raw.toUpperCase();}
}
