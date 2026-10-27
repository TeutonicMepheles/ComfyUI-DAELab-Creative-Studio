export {createTableButton,tableTheme,tableIcon} from '../../ui/table_controls.mjs';
import {businessHost} from '../../contracts/business.js';
export function tableHistory(){return businessHost().history;}
