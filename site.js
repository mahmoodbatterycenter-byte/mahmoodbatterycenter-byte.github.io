// site.js — the page's own hook into the mounted runtime. Kept deliberately small: the
// UI, the consent prompts and the action review dialog all come from the vendored
// reference runtime. Everything here is progressive enhancement and must survive the
// reference UI changing its markup, so nothing reaches for a selector it has to have.

export async function customize({ root, runtime }) {
  const engine = runtime.engine;

  // The suggestion buttons type into the composer when the runtime exposes one. They never
  // start a turn on the visitor's behalf: the send button stays the visitor's decision.
  const composer = root.querySelector("textarea, input[type='text']");
  for (const button of document.querySelectorAll("[data-try]")) {
    button.addEventListener("click", () => {
      if (!composer) {
        button.insertAdjacentText("afterend", " (type it into the box above)");
        return;
      }
      composer.value = button.textContent.trim();
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.focus();
    });
  }

  // Say out loud which inference path is live. Spec 5: observable execution, without
  // exposing the key.
  const line = document.createElement("p");
  line.className = "tiny";
  const describe = () => {
    const router = engine.userRouter || engine.top?.llm || {};
    const mock = !!engine.mockLLM;
    line.textContent = mock
      ? "Inference now: this site's published default path — the reference runtime's deterministic mock. No key is used and nothing leaves this browser; the tool answers and citations are still real. Open AI model settings to bring your own key."
      : `Inference now: bring-your-own-key against ${router.baseUrl || "the selected router"}. The key is attached only to model requests; the rules-authority site never sees it.`;
    if (router.model) line.textContent += ` Model: ${router.model}.`;
  };
  describe();
  document.querySelector("#agent")?.append(line);
  engine.trace?.addEventListener?.("event", describe); // TraceBus emits one "event" per trace step
}
