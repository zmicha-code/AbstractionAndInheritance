import { RNPlugin, PluginRem, RichTextInterface } from "@remnote/plugin-sdk";
import { ReactNode } from "react";
import katex from "katex";
import "katex/contrib/mhchem"; // Enable \ce and \pu commands for chemistry
// @ts-ignore - CSS import
import "katex/dist/katex.min.css";

/**
 * Regex to match cloze syntax in LaTeX: {{c1::content}}, {{c2::content}}, etc.
 * The (?!\}) negative lookahead handles nested braces like \frac{F}{A}}}.
 */
const CLOZE_PATTERN = /\{\{c(\d+)::([\s\S]*?)\}\}(?!\})/g;

/**
 * Strips cloze markers from LaTeX code, keeping the content.
 * E.g., "{{c1::x^2}}" becomes "x^2"
 */
function stripClozeMarkers(latexCode: string): string {
  return latexCode.replace(CLOZE_PATTERN, '$2');
}

/**
 * Fallback map of color indices to CSS colors.
 * Used when the color value is a number (index into RemNote's palette).
 */
const fallbackColors: Record<number, string> = {
  1: "#ff6b6b",   // Red
  2: "#ffa94d",   // Orange
  3: "#ffd43b",   // Yellow
  4: "#69db7c",   // Green
  5: "#da77f2",   // Purple
  6: "#4dabf7",   // Blue
  7: "#888888",   // Gray
  8: "#a1887f",   // Brown
  9: "#f48fb1",   // Pink
};

/**
 * Resolves a color value from RemNote's rich text formatting.
 */
function resolveColor(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  
  if (typeof value === "string") {
    if (value.startsWith("#") || value.startsWith("rgb")) {
      return value;
    }
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && fallbackColors[parsed]) {
      return fallbackColors[parsed];
    }
    return value;
  }
  
  if (typeof value === "number" && fallbackColors[value]) {
    return fallbackColors[value];
  }
  
  return undefined;
}

/**
 * Get plain text from a Rem (for reference names).
 */
async function getRemPlainText(plugin: RNPlugin, rem: PluginRem | undefined): Promise<string> {
  if (!rem) return "";
  const richText = rem.text;
  if (!richText) return "";

  const textParts = await Promise.all(
    richText.map(async (item) => {
      if (typeof item === "string") {
        return item;
      }
      switch (item.i) {
        case "m":
        case "x":
        case "n":
          return item.text || "";
        case "q":
          const referencedRem = await plugin.rem.findOne(item._id);
          if (referencedRem) {
            return await getRemPlainText(plugin, referencedRem);
          } else if (item.textOfDeletedRem) {
            return await getPlainTextFromRichText(plugin, item.textOfDeletedRem);
          }
          return "";
        case "i":
          return "[image]";
        default:
          return "";
      }
    })
  );

  return textParts.join("");
}

/**
 * Get plain text from RichTextInterface.
 */
async function getPlainTextFromRichText(plugin: RNPlugin, richText: RichTextInterface): Promise<string> {
  const textParts = await Promise.all(
    richText.map(async (item) => {
      if (typeof item === "string") {
        return item;
      }
      switch (item.i) {
        case "m":
        case "x":
        case "n":
          return item.text || "";
        case "q":
          const referencedRem = await plugin.rem.findOne(item._id);
          if (referencedRem) {
            return await getRemPlainText(plugin, referencedRem);
          } else if (item.textOfDeletedRem) {
            return await getPlainTextFromRichText(plugin, item.textOfDeletedRem);
          }
          return "";
        default:
          return "";
      }
    })
  );
  return textParts.join("");
}

/**
 * Get the hierarchical path of a Rem as a formatted string.
 */
async function getRemPath(plugin: RNPlugin, rem: PluginRem): Promise<string> {
  const pathParts: string[] = [];
  let currentRem: PluginRem | undefined = rem;
  
  while (currentRem) {
    const text = await getRemPlainText(plugin, currentRem);
    pathParts.unshift(text || "(untitled)");
    currentRem = await currentRem.getParentRem();
  }
  
  return pathParts.join(" > ");
}

/**
 * Process RichTextInterface and return React elements for rendering.
 * Handles: text, bold, italic, highlights, colors, LaTeX, references, images.
 */
export async function processRichTextToElements(
  plugin: RNPlugin,
  richText: RichTextInterface
): Promise<ReactNode[]> {
  const elements: ReactNode[] = [];

  for (let idx = 0; idx < richText.length; idx++) {
    const item = richText[idx];

    if (typeof item === "string") {
      elements.push(<span key={idx}>{item}</span>);
      continue;
    }

    switch (item.i) {
      case "q": {
        // Reference to another rem
        const referencedRem = await plugin.rem.findOne(item._id);
        let refText = "";
        let refPath = "";
        if (referencedRem) {
          refText = await getRemPlainText(plugin, referencedRem);
          refPath = await getRemPath(plugin, referencedRem);
        } else if (item.textOfDeletedRem) {
          refText = await getPlainTextFromRichText(plugin, item.textOfDeletedRem);
          refPath = refText;
        }
        
        const remId = item._id;
        const handleClick = async () => {
          const rem = await plugin.rem.findOne(remId);
          if (rem) {
            await rem.openRemAsPage();
          }
        };
        
        elements.push(
          <span
            key={idx}
            style={{
              color: "#5277b1",
              cursor: "pointer",
              fontWeight: "bold",
            }}
            title={refPath}
            onClick={handleClick}
          >
            {refText || "(deleted reference)"}
          </span>
        );
        break;
      }

      case "m": {
        // Formatted text
        const text = item.text || "";
        const style: React.CSSProperties = {};
        const itemAny = item as any;

        if (item.b) style.fontWeight = "bold";
        if (item.l) style.fontStyle = "italic";
        if (itemAny.s) style.textDecoration = "line-through";
        if (item.u) {
          style.textDecoration = style.textDecoration
            ? `${style.textDecoration} underline`
            : "underline";
        }

        if (item.h !== undefined) {
          const bgColor = resolveColor(item.h);
          if (bgColor) {
            style.backgroundColor = bgColor;
            style.padding = "0 2px";
            style.borderRadius = "2px";
          }
        }

        if (itemAny.tc !== undefined) {
          const textColor = resolveColor(itemAny.tc);
          if (textColor) style.color = textColor;
        }

        if (item.code) {
          style.fontFamily = "monospace";
          style.backgroundColor = "#2d2d2d";
          style.padding = "1px 4px";
          style.borderRadius = "3px";
          style.fontSize = "0.9em";
        }

        const linkUrl = itemAny.url;
        if (linkUrl) {
          style.color = style.color || "#4dabf7";
          style.textDecoration = "underline";
          style.cursor = "pointer";
          
          elements.push(
            <a
              key={idx}
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={style}
              title={linkUrl}
            >
              {text || linkUrl}
            </a>
          );
        } else {
          elements.push(
            <span key={idx} style={style}>
              {text}
            </span>
          );
        }
        break;
      }

      case "i": {
        // Image - render inline with constraints for nodes
        const imageItem = item as any;
        let imageUrl = imageItem.url || "";
        
        if (imageUrl.startsWith("%LOCAL_FILE%")) {
          const fileId = imageUrl.replace("%LOCAL_FILE%", "");
          imageUrl = `https://remnote-user-data.s3.amazonaws.com/${fileId}`;
        }
        
        if (imageUrl) {
          elements.push(
            <img
              key={idx}
              src={imageUrl}
              alt={imageItem.title || "Image"}
              style={{
                maxWidth: "60px",
                maxHeight: "30px",
                objectFit: "contain",
                display: "inline-block",
                verticalAlign: "middle",
                margin: "0 2px",
                borderRadius: "2px",
              }}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
              }}
            />
          );
        }
        break;
      }

      case "x": {
        // LaTeX - strip cloze markers before rendering
        let latexCode = item.text || "";
        latexCode = stripClozeMarkers(latexCode);
        const isBlock = item.block === true;
        
        try {
          const html = katex.renderToString(latexCode, {
            throwOnError: false,
            displayMode: isBlock,
            output: "html",
            strict: false,
            trust: true,
          });
          
          elements.push(
            <span
              key={idx}
              dangerouslySetInnerHTML={{ __html: html }}
              style={{
                display: isBlock ? "block" : "inline",
                textAlign: isBlock ? "center" : undefined,
              }}
            />
          );
        } catch (err) {
          // Fallback to raw text if KaTeX fails
          elements.push(
            <span key={idx} style={{ fontFamily: "monospace", color: "#e74c3c" }}>
              {latexCode}
            </span>
          );
        }
        break;
      }

      case "n": {
        // Annotation text
        const text = item.text || "";
        elements.push(<span key={idx}>{text}</span>);
        break;
      }

      default: {
        const itemAny = item as any;
        
        // URL/Link element
        if (itemAny.i === "u") {
          const url = itemAny.url || "";
          const title = itemAny.title || url;
          
          elements.push(
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#4dabf7",
                textDecoration: "underline",
                cursor: "pointer",
              }}
              title={url}
            >
              {title}
            </a>
          );
          break;
        }
        
        // Fallback: extract text if available
        const unknownItem = item as unknown as { text?: string };
        if (unknownItem.text && typeof unknownItem.text === "string") {
          elements.push(<span key={idx}>{unknownItem.text}</span>);
        }
        break;
      }
    }
  }

  return elements;
}

/**
 * Synchronously process rich text for simple cases (no refs at render time).
 * Returns elements without resolving references - references show as placeholders.
 * Use this when you already have the data loaded and don't need async resolution.
 */
export function processRichTextSync(richText: RichTextInterface): ReactNode[] {
  const elements: ReactNode[] = [];

  for (let idx = 0; idx < richText.length; idx++) {
    const item = richText[idx];

    if (typeof item === "string") {
      elements.push(<span key={idx}>{item}</span>);
      continue;
    }

    switch (item.i) {
      case "q": {
        // Reference - show as placeholder (can't resolve synchronously)
        elements.push(
          <span
            key={idx}
            style={{
              color: "#5277b1",
              fontWeight: "bold",
            }}
          >
            {"[ref]"}
          </span>
        );
        break;
      }

      case "m": {
        const text = item.text || "";
        const style: React.CSSProperties = {};
        const itemAny = item as any;

        if (item.b) style.fontWeight = "bold";
        if (item.l) style.fontStyle = "italic";
        if (itemAny.s) style.textDecoration = "line-through";
        if (item.u) {
          style.textDecoration = style.textDecoration
            ? `${style.textDecoration} underline`
            : "underline";
        }

        if (item.h !== undefined) {
          const bgColor = resolveColor(item.h);
          if (bgColor) {
            style.backgroundColor = bgColor;
            style.padding = "0 2px";
            style.borderRadius = "2px";
          }
        }

        if (itemAny.tc !== undefined) {
          const textColor = resolveColor(itemAny.tc);
          if (textColor) style.color = textColor;
        }

        if (item.code) {
          style.fontFamily = "monospace";
          style.backgroundColor = "#2d2d2d";
          style.padding = "1px 4px";
          style.borderRadius = "3px";
          style.fontSize = "0.9em";
        }

        const linkUrl = itemAny.url;
        if (linkUrl) {
          style.color = style.color || "#4dabf7";
          style.textDecoration = "underline";
          
          elements.push(
            <a
              key={idx}
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={style}
              title={linkUrl}
            >
              {text || linkUrl}
            </a>
          );
        } else {
          elements.push(
            <span key={idx} style={style}>
              {text}
            </span>
          );
        }
        break;
      }

      case "i": {
        const imageItem = item as any;
        let imageUrl = imageItem.url || "";
        
        if (imageUrl.startsWith("%LOCAL_FILE%")) {
          const fileId = imageUrl.replace("%LOCAL_FILE%", "");
          imageUrl = `https://remnote-user-data.s3.amazonaws.com/${fileId}`;
        }
        
        if (imageUrl) {
          elements.push(
            <img
              key={idx}
              src={imageUrl}
              alt={imageItem.title || "Image"}
              style={{
                maxWidth: "60px",
                maxHeight: "30px",
                objectFit: "contain",
                display: "inline-block",
                verticalAlign: "middle",
                margin: "0 2px",
                borderRadius: "2px",
              }}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
              }}
            />
          );
        }
        break;
      }

      case "x": {
        // LaTeX - strip cloze markers before rendering
        let latexCode = item.text || "";
        latexCode = stripClozeMarkers(latexCode);
        const isBlock = item.block === true;
        
        try {
          const html = katex.renderToString(latexCode, {
            throwOnError: false,
            displayMode: isBlock,
            output: "html",
            strict: false,
            trust: true,
          });
          
          elements.push(
            <span
              key={idx}
              dangerouslySetInnerHTML={{ __html: html }}
              style={{
                display: isBlock ? "block" : "inline",
                textAlign: isBlock ? "center" : undefined,
              }}
            />
          );
        } catch (err) {
          elements.push(
            <span key={idx} style={{ fontFamily: "monospace", color: "#e74c3c" }}>
              {latexCode}
            </span>
          );
        }
        break;
      }

      case "n": {
        const text = item.text || "";
        elements.push(<span key={idx}>{text}</span>);
        break;
      }

      default: {
        const itemAny = item as any;
        
        if (itemAny.i === "u") {
          const url = itemAny.url || "";
          const title = itemAny.title || url;
          
          elements.push(
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#4dabf7",
                textDecoration: "underline",
              }}
              title={url}
            >
              {title}
            </a>
          );
          break;
        }
        
        const unknownItem = item as unknown as { text?: string };
        if (unknownItem.text && typeof unknownItem.text === "string") {
          elements.push(<span key={idx}>{unknownItem.text}</span>);
        }
        break;
      }
    }
  }

  return elements;
}

/**
 * RichTextLabel component for rendering rich text in nodes.
 * Renders synchronously using processRichTextSync.
 */
interface RichTextLabelProps {
  richText?: RichTextInterface;
  fallback?: string;
  style?: React.CSSProperties;
  prefix?: string;  // Optional prefix like "⊕ " for virtual nodes
}

export function RichTextLabel({ richText, fallback, style, prefix }: RichTextLabelProps) {
  if (!richText || richText.length === 0) {
    return <span style={style}>{prefix}{fallback || "(empty)"}</span>;
  }
  
  const elements = processRichTextSync(richText);
  
  return (
    <span style={{ ...style, display: 'inline' }}>
      {prefix}
      {elements}
    </span>
  );
}
