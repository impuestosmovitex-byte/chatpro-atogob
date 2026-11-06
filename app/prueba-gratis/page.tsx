import {redirect} from 'next/navigation';
/** Legacy campaign URL: MW1 does not offer a free trial. */
export default function LegacyTrialPage(){redirect('/demo');}
