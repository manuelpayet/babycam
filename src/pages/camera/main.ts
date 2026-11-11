import '../../shared/style.css';
import { applyTranslations, initLangSelect } from '../../shared/i18n';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);
