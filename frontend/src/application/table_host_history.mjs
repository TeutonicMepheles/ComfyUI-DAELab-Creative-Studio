import {businessHost} from '../contracts/business.js';
// Compatibility for adjacent panels. The table editor itself receives its document port.
export function tableHistory(){return businessHost().history;}
