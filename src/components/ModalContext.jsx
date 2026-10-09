import { createContext, useCallback, useContext, useState } from "react";
import CopyrightModal from "./CopyrightModal.jsx";

const ModalContext = createContext(() => {});

export const useCopyrightModal = () => useContext(ModalContext);

export function ModalProvider({ children }) {
  const [open, setOpen] = useState(false);
  const openModal = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <ModalContext.Provider value={openModal}>
      {children}
      {open ? <CopyrightModal onClose={close} /> : null}
    </ModalContext.Provider>
  );
}
