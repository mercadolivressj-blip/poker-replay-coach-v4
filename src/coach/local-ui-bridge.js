function patchOpponentCopy() {
  const title = document.getElementById('proOpponentTitle');
  const meta = document.getElementById('proOpponentMeta');
  const reasons = document.getElementById('proOpponentReasons');
  const current = String(title?.textContent || '');
  if (!title) return;
  if (/ative a vision|aguardando linha|aguardando ações|aguardando ação explícita/i.test(current)) {
    title.textContent = 'Aguardando ação observável na mesa';
    if (meta) meta.textContent = 'Range oculto · stacks + fichas comprometidas + ações visíveis';
    if (reasons) reasons.textContent = 'O chat do Dealer não é requisito. Sem evidência visual suficiente, o Coach reduz a confiança e não inventa a ação.';
  }
}

const observer = new MutationObserver(() => patchOpponentCopy());
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
patchOpponentCopy();
setInterval(patchOpponentCopy, 300);
