export const APP_VERSION = "v159";
export const RELEASE_TRACKING = "ABAS-159";

export function AppVersion() {
  return <p className="mt-1 text-xs font-medium text-slate-600" title={RELEASE_TRACKING}>Versão {APP_VERSION}</p>;
}
