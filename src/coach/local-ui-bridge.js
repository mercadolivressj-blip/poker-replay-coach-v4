function patchOpponentCopy() {
  const title = document.getElementById('proOpponentTitle');
  const meta = document.getElementById('proOpponentMeta');
  const reasons = document.getElementById('proOpponentReasons');
  if (title && /ative a vision/i.test(title.textContent || '')) {
    title.textContent = 'Aguardando ação explícita do rival';
    if (meta) meta.textContent = 'Range oculto · histórico local + observações do replay';
    if (reasons && !reasons.textContent?.trim()) reasons.textContent = 'O Coach só usa ações que conseguiu observar; sem evidência, a confiança cai.';
  }
}

const observer = new MutationObserver(() => patchOpponentCopy());
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
patchOpponentCopy();
setInterval(patchOpponentCopy, 300);
