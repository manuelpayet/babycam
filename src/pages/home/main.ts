import '../../shared/style.css';
import { applyTranslations, initLangSelect } from '../../shared/i18n';
import { registerPwa } from '../../shared/pwa';
import { setBuildBadge } from '../../shared/ui';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);
registerPwa();
setBuildBadge();
