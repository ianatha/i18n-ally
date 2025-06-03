import { TextDocument } from 'vscode'
import { KeyStyle, RewriteKeyContext, RewriteKeySource } from '~/core'
import { LanguageId } from '~/utils'
import { Framework, ScopeRange } from './base';

class NextIntlFramework extends Framework {
  id = "next-intl";
  display = "next-intl";
  namespaceDelimiter = ".";
  perferredKeystyle?: KeyStyle = "nested";

  namespaceDelimiters = ["."];
  namespaceDelimitersRegex = /[\.]/g;

  detection = {
    packageJSON: ["next-intl"]
  };

  languageIds: LanguageId[] = [
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact",
    "ejs"
  ];

  usageMatchRegex = [
    // Basic usage - match any variable name that could be a translation function
    // This is intentionally broad since we rely on getScopeRange for precise scoping
    "[^\\w\\d]\\w+\\s*\\(\\s*['\"`]({key})['\"`]",

    // Rich text methods
    "[^\\w\\d]\\w+\\s*\\.rich\\s*\\(\\s*['\"`]({key})['\"`]",

    // Markup text methods
    "[^\\w\\d]\\w+\\s*\\.markup\\s*\\(\\s*['\"`]({key})['\"`]",

    // Raw text methods
    "[^\\w\\d]\\w+\\s*\\.raw\\s*\\(\\s*['\"`]({key})['\"`]"
  ];

  refactorTemplates(keypath: string) {
    // Ideally we'd automatically consider the namespace here. Since this
    // doesn't seem to be possible though, we'll generate all permutations for
    // the `keypath`. E.g. `one.two.three` will generate `three`, `two.three`,
    // `one.two.three`.

    const keypaths = keypath.split(".").map((cur, index, parts) => {
      return parts.slice(parts.length - index - 1).join(".");
    });
    return [
      ...keypaths.map(cur => `{t('${cur}')}`),
      ...keypaths.map(cur => `t('${cur}')`)
    ];
  }

  rewriteKeys(
    key: string,
    source: RewriteKeySource,
    context: RewriteKeyContext = {}
  ) {
    const dottedKey = key.split(this.namespaceDelimitersRegex).join(".");

    // When the namespace is explicitly set, ignore the current namespace scope
    if (
      this.namespaceDelimiters.some(delimiter => key.includes(delimiter)) &&
      context.namespace &&
      dottedKey.startsWith(
        context.namespace.split(this.namespaceDelimitersRegex).join(".")
      )
    ) {
      // +1 for the an extra `.`
      key = key.slice(context.namespace.length + 1);
    }

    return dottedKey;
  }

  getScopeRange(document: TextDocument): ScopeRange[] | undefined {
    if (!this.languageIds.includes(document.languageId as any)) return;

    const ranges: ScopeRange[] = [];
    const text = document.getText();

    // Map to track variable names and their associated namespaces
    const variableNamespaces = new Map<string, string>();

    // Find variable assignments with useTranslations and getTranslations
    // Handles: const t = useTranslations("Source")
    // Handles: const wp = useTranslations("Source.wordPressConnection")
    // Handles: const t = await getTranslations({namespace: "Source"})
    const assignmentRegex = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:['"](.*?)['"]|\{\s*[^}]*?namespace:\s*['"](.*?)['"][^}]*?\})?\s*\)/g;

    for (const match of text.matchAll(assignmentRegex)) {
      const varName = match[1];
      const namespace = match[2] || match[3]; // Direct string or from object

      if (namespace) {
        variableNamespaces.set(varName, namespace);
      }
    }

    // Create specific scopes for each variable usage
    for (const [varName, namespace] of variableNamespaces) {
      // Create a more specific regex for this variable name
      // This will match: varName('key'), varName.rich('key'), etc.
      const usageRegex = new RegExp(
        `\\b${varName}\\s*(?:\\.(?:rich|markup|raw))?\\s*\\([\\s]*['"]([^'"]*?)['"]`,
        "g"
      );

      for (const match of text.matchAll(usageRegex)) {
        if (typeof match.index !== "number") continue;

        // Find where the key starts within the match
        const keyStartInMatch = match[0].indexOf(match[1]);
        const keyStart = match.index + keyStartInMatch;
        const keyEnd = keyStart + match[1].length;

        ranges.push({
          start: keyStart,
          end: keyEnd,
          namespace
        });
      }
    }

    return ranges;
  }
}

export default NextIntlFramework;
