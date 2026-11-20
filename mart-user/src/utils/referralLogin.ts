import { useAccountLoginStore } from '../store/accountLoginStore';
import { useLoginFlowStore } from '../store/loginFlowStore';

export function openReferralLogin(returnPath: string): void {
  const flow = useLoginFlowStore.getState();
  flow.clear();
  flow.setPostLoginPath(returnPath);
  flow.setGuestReturnPath(returnPath);
  useAccountLoginStore.getState().openLogin();
  window.history.replaceState({}, '', '/login');
  window.dispatchEvent(new PopStateEvent('popstate'));
}
