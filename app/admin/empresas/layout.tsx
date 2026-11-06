import type {ReactNode} from 'react';

/** The platform navigation is fixed-positioned inside the page. Avoid the old
 * tenant grid here: it incorrectly puts the only flow child under the sidebar. */
export default function EmpresasAdminLayout({children}:{children:ReactNode}){
  return <>{children}</>;
}
