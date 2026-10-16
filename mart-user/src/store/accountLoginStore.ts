import { create } from 'zustand';

// Coordinates the Account page's guest login: the header greeting ("Hi Guest")
// lives in the Navbar while the login page itself is rendered by AccountPage,
// so a tiny shared flag lets either one open it. Session-only on purpose: a
// reload should drop the shopper back on the Account page, not mid-login.
interface AccountLoginState {
  open: boolean;
  openLogin: () => void;
  closeLogin: () => void;
}

export const useAccountLoginStore = create<AccountLoginState>((set) => ({
  open: false,
  openLogin: () => set({ open: true }),
  closeLogin: () => set({ open: false }),
}));
