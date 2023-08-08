import { CompletionItem, CompletionItemKind, Definition, Diagnostic, Hover, InsertTextFormat, TextDocuments, WorkspaceFolder } from "vscode-languageserver";
import { Position, TextDocument } from "vscode-languageserver-textdocument";
import { Node, HTMLDocument, TokenType } from "vscode-html-languageservice";
import { ComponentManager } from "./component";

/**
 * 获取 vue 文件的语言服务器
 *
 * 当文档变更时，需要解析的必要信息
 *
 * @param documents 文档管理器
 * @returns 语言服务器
 */
export default class VueLanguageService {
    public documents: TextDocuments<TextDocument>;
    public componentManager: ComponentManager;

    constructor(documents: TextDocuments<TextDocument>, workspaceFolders: WorkspaceFolder[] | null) {
        this.documents = documents;
        this.componentManager = new ComponentManager(documents, workspaceFolders);
    }

    /** 获取模版中的诊断信息 */
    public getDiagnostics(document: TextDocument): Diagnostic[] {
        return [];
    }

    /** 鼠标悬浮显示信息 */
    public doHover(document: TextDocument, position: Position): Hover | null {
        const { type, text, tokenOffset, tag } = this.getVueTokenType(document, position);
        const components = this.componentManager.getComponents(document.uri);
        const component = components.find(v => v.name === tag);
        if (component) {
            const range = {
                start: document.positionAt(tokenOffset),
                end: document.positionAt(tokenOffset + tag.length),
            };
            switch (type) {
                case VueTokenType.ComponentName:
                    return {
                        range,
                        contents: {
                            kind: "markdown",
                            value: [
                                "```typescript",
                                `class ${tag}`,
                                "```",
                                component.jsDocComment,
                            ].join("\n"),
                        },
                    };
                case VueTokenType.AttributeName:
                    const attribute = text.replace(/^:/, "");
                    if (component.model && (attribute === "v-model" || component.model?.name === attribute)) {
                        return {
                            range,
                            contents: {
                                kind: "markdown",
                                value: [
                                    "```typescript",
                                    `(model) ${attribute}: ${component.model.type}`,
                                    "```",
                                    component.model.jsDocComment,
                                ].join("\n"),
                            },
                        };
                    }
                    const prop = component.props.find(v => v.name === attribute);
                    if (prop) {
                        return {
                            range,
                            contents: [
                                "```typescript",
                                `(prop) ${attribute}: ${prop.type}`,
                                "```",
                                prop.jsDocComment,
                            ].join("\n"),
                        };
                    }
                    break;
            }
        }
        return null;
    }

    /** 自动补全 */
    public doComplete(document: TextDocument, position: Position): CompletionItem[] {
        const tokenTypeResult = this.getVueTokenType(document, position);
        switch (tokenTypeResult.type) {
            case VueTokenType.ComponentNameContent:
                return this.getCompleteFromComponentNameContent(document, position);

            case VueTokenType.AttributeName:
                return this.getCompleteFromAttributeName(document, position, tokenTypeResult);
        }
        return [];
    }

    /** 跳到定义 */
    public doDefinition(document: TextDocument, position: Position): Definition {
        const tokenTypeResult = this.getVueTokenType(document, position);
        switch (tokenTypeResult.type) {
            case VueTokenType.ComponentName:
                return this.getDefinitionFromComponentName(document, tokenTypeResult);
        }
        return [];
    }

    /** 获取当前所处的位置类型 */
    private getVueTokenType(document: TextDocument, position: Position): VueTokenTypeResult {
        const offset = document.offsetAt(position);
        const htmlDocument = this.componentManager.getHtmlDocument(document) as HTMLDocument;
        const node = htmlDocument.findNodeAt(offset);
        const { scanner, tag } = this.getNodeTokens(document, node, offset);
        const text = scanner.getTokenText();
        const tokenOffset = scanner.getTokenOffset() + node.start;
        switch (scanner.getTokenType()) {
            case TokenType.StartTag:
            case TokenType.EndTag:
                if (/^[A-Z]/.test(text)) {
                    return { type: VueTokenType.ComponentName, text, tokenOffset, tag };
                }
                break;

            case TokenType.AttributeName:
                return { type: VueTokenType.AttributeName, text, tokenOffset, tag };

            case TokenType.Content:
                const content = scanner.getTokenText();
                if (/^\s*[A-Z][a-zA-Z0-9]*\s*$/.test(content)) {
                    return { type: VueTokenType.ComponentNameContent, text, tokenOffset, tag };
                }
                break;
        }
        return { type: VueTokenType.Other, text, tokenOffset, tag };
    }

    private getCompleteFromComponentNameContent(document: TextDocument, position: Position): CompletionItem[] {
        const offset = document.offsetAt(position);
        const htmlDocument = this.componentManager.getHtmlDocument(document) as HTMLDocument;
        const node = htmlDocument.findNodeAt(offset);
        const { scanner } = this.getNodeTokens(document, node, offset);
        const content = scanner.getTokenText();
        const match = (/^(\s*)([A-Z][a-zA-Z0-9]*)\s*$/.exec(content)) as RegExpExecArray;
        const space = match[1];
        const name = match[2];
        const tokenOffset = node.start + scanner.getTokenOffset();
        const start = document.positionAt(tokenOffset + space.length);
        const end = document.positionAt(tokenOffset + space.length + name.length);
        return this.componentManager.getComponents(document.uri).map(c => ({
            label: c.name,
            kind: CompletionItemKind.Class,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: {
                range: { start, end },
                newText: `<${c.name}>$0</${c.name}>`,
            },
            documentation: {
                kind: "markdown",
                value: c.jsDocComment,
            },
        }));
    }

    private getCompleteFromAttributeName(document: TextDocument, position: Position, tokenTypeResult: VueTokenTypeResult): CompletionItem[] {
        const { tag, text, tokenOffset } = tokenTypeResult;
        const offset = document.offsetAt(position);
        const htmlDocument = this.componentManager.getHtmlDocument(document) as HTMLDocument;
        const node = htmlDocument.findNodeAt(offset);
        const components = this.componentManager.getComponents(document.uri);
        const component = components.find(v => v.name === tag);
        if (component) {
            const attrs = this.getNodeAttributes(document, node);
            const props = [...(component.model ? [component.model] : []), ...component.props];
            return props.map(prop => ({
                label: prop.name,
                kind: CompletionItemKind.Property,
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: `:${prop.name}`,
                textEdit: {
                    range: {
                        start: document.positionAt(tokenOffset),
                        end: document.positionAt(tokenOffset + text.length),
                    },
                    newText: `:${prop.name}="$0"`,
                },
                documentation: {
                    kind: "markdown" as "markdown",
                    value: prop.jsDocComment,
                },
            })).filter(item => !attrs.find(v => v.replace(/^:/, "") === item.label));
        }
        return [];
    }

    private getDefinitionFromComponentName(document: TextDocument, tokenTypeResult: VueTokenTypeResult): Definition {
        const { tag } = tokenTypeResult;
        const components = this.componentManager.getComponents(document.uri);
        const component = components.find(v => v.name === tag);
        if (component) {
            return {
                uri: component.uri,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }},
            };
        }
        return [];
    }

    /** 解析 html 节点，获取 token 和当前所在的 token 的 scanner */
    private getNodeTokens(document: TextDocument, node: Node, offset: number) {
        const content = document.getText().slice(node.start, node.end);
        const scanner = this.componentManager.htmlLanguageService.createScanner(content);
        const tokens: string[] = [];
        let token = scanner.scan();
        let tag = "";
        while (token !== TokenType.EOS) {
            const text = scanner.getTokenText();
            tokens.push(text);
            if (token === TokenType.StartTag) {
                tag = text;
            }
            if (scanner.getTokenOffset() + scanner.getTokenLength() >= offset - node.start) {
                break;
            }
            token = scanner.scan();
        }
        return { tag, scanner, tokens };
    }

    private getNodeAttributes(document: TextDocument, node: Node) {
        const content = document.getText().slice(node.start, node.end);
        const scanner = this.componentManager.htmlLanguageService.createScanner(content);
        const attributes: string[] = [];
        let token = scanner.scan();
        while (![TokenType.EOS, TokenType.StartTagClose, TokenType.StartTagSelfClose].includes(token)) {
            if (token === TokenType.AttributeName) {
                attributes.push(scanner.getTokenText());
            }
            token = scanner.scan();
        }
        return attributes;
    }
}

interface VueTokenTypeResult {
    type: VueTokenType;
    text: string;
    tokenOffset: number;
    tag: string;
}

enum VueTokenType {
    /** 组件名称 */
    ComponentName,
    /** 属性名 */
    AttributeName,
    /** 可能是组件名称的内容 */
    ComponentNameContent,
    /** 其他 */
    Other,
}
