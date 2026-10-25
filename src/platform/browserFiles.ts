/** A user gesture opens the browser's file chooser; no native filesystem access. */
export function pickBrowserFile(accept: string): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.hidden = true;
    const finish = (file?: File) => {input.remove(); resolve(file);};
    input.addEventListener('change', () => finish(input.files?.[0]), {once: true});
    input.addEventListener('cancel', () => finish(), {once: true});
    document.body.append(input); input.click();
  });
}
