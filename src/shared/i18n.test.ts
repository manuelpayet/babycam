import { describe, expect, it } from 'vitest';
import { DICTS, getLang, LANGS, setLang, t } from './i18n';

describe('i18n', () => {
  it('bascule entre fr et en', () => {
    setLang('fr');
    expect(getLang()).toBe('fr');
    expect(t('home.camera')).toBe('Je surveille (caméra)');
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('home.camera')).toBe('I monitor (camera)');
  });

  it('retombe sur la clé si elle est inconnue', () => {
    expect(t('cle.inconnue')).toBe('cle.inconnue');
  });

  it('toutes les langues ont exactement les mêmes clés', () => {
    const ref = Object.keys(DICTS.en).sort();
    for (const lang of LANGS) {
      expect(Object.keys(DICTS[lang]).sort()).toEqual(ref);
    }
  });
});
