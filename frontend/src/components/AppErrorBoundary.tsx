import { Component, type ErrorInfo, type ReactNode } from "react";
import { LanguageContext } from "../services/language";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  static contextType = LanguageContext;
  declare context: React.ContextType<typeof LanguageContext>;

  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Frontend rendering failed", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const copy = this.context.language === "kn"
      ? { title: "ಈ ಪುಟವನ್ನು ತೋರಿಸಲಾಗಲಿಲ್ಲ", body: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. ಸಮಸ್ಯೆ ಮುಂದುವರಿದರೆ ಪುಟವನ್ನು ಮರುಲೋಡ್ ಮಾಡಿ.", retry: "ಮರುಲೋಡ್ ಮಾಡಿ" }
      : { title: "This page couldn't be displayed", body: "Try again. If the problem continues, reload the page.", retry: "Reload page" };

    return <section className="app-error panel" role="alert">
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      <button className="button-primary" onClick={() => window.location.reload()}>{copy.retry}</button>
    </section>;
  }
}
