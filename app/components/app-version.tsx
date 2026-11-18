export const APP_VERSION = "v160";
export const RELEASE_TRACKING = "ABAS-160";

export function AppVersion() {
  return <p className="mt-1 text-xs font-medium text-slate-600" title={RELEASE_TRACKING}>Versão {APP_VERSION}</p>;
}
