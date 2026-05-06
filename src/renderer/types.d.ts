import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          poster?: string;
          "camera-controls"?: boolean | string;
          "auto-rotate"?: boolean | string;
          "auto-rotate-delay"?: number | string;
          "rotation-per-second"?: string;
          "shadow-intensity"?: number | string;
          "exposure"?: number | string;
          "environment-image"?: string;
          "interaction-prompt"?: string;
          "ar"?: boolean | string;
          loading?: "lazy" | "eager";
          reveal?: "auto" | "manual";
          ref?: any;
        },
        HTMLElement
      >;
    }
  }
}
