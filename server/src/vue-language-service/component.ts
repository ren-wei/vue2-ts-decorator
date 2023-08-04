import * as ts from "typescript";
import { TextDocuments, WorkspaceFolder } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LanguageService as HtmlLanguageService, getLanguageService, HTMLDocument } from "vscode-html-languageservice";
import { getComponentsPath, parseComponent } from "./parse";
import { getAbsolutePath, getScriptString, getUri } from "./tools";
import { existsSync, readFileSync } from "fs";

/**
 * 组件管理器
 */
export class ComponentManager {
    public documents: TextDocuments<TextDocument>;

    public htmlLanguageService: HtmlLanguageService;

    public workspaceFolders: WorkspaceFolder[] | null;

    /** 缓存组件，key 是文件的 uri */
    private cacheVueComponent = new Map<string, VueComponent>();

    /** 缓存已注册组件的映射表 */
    private cacheComponentsMap = new Map<string, VueComponent[]>();

    private cacheHtmlDocument = new Map<string, HTMLDocument>();

    private cacheSourceFile = new Map<string, ts.SourceFile>();

    constructor(documents: TextDocuments<TextDocument>, workspaceFolders: WorkspaceFolder[] | null) {
        this.documents = documents;
        this.workspaceFolders = workspaceFolders;
        this.htmlLanguageService = getLanguageService();
        this.onDocumentChangeClearCache();
    }

    private onDocumentChangeClearCache() {
        this.documents.onDidChangeContent(({ document }) => {
            // 当前组件的缓存
            this.cacheVueComponent.delete(document.uri);
            this.cacheComponentsMap.delete(document.uri);
            this.cacheHtmlDocument.delete(document.uri);
            this.cacheSourceFile.delete(document.uri);
            // 涉及当前组件的缓存
            const keys = [...this.cacheComponentsMap.keys()];
            keys.forEach(key => {
                const list = this.cacheComponentsMap.get(key) as VueComponent[];
                if (list.find(v => v.uri === document.uri)) {
                    this.cacheComponentsMap.delete(key);
                }
            });
        });
    }

    public getHtmlDocument(document: TextDocument) {
        if (this.cacheHtmlDocument.has(document.uri)) {
            return this.cacheHtmlDocument.get(document.uri) as HTMLDocument;
        }
        const htmlDocument = this.htmlLanguageService.parseHTMLDocument(document);
        this.cacheHtmlDocument.set(document.uri, htmlDocument);
        return htmlDocument;
    }

    /**
     * 获取组件
     * @param path 相对路径或 uri
     * @param baseUri 如果是相对路径，那么需要当前文件的 uri
     * @returns 组件信息，如果组件不存在，那么返回 null
     */
    public getVueComponent(path: string, baseUri?: string) {
        const uri = getUri(path, baseUri);
        // 从缓存中获取
        if (this.cacheVueComponent.has(uri)) {
            return this.cacheVueComponent.get(uri) as VueComponent;
        }
        let document = this.documents.get(uri);
        if (!document) {
            // 从文件系统获取
            const absolutePath = getAbsolutePath(uri);
            if (existsSync(absolutePath)) {
                const content = readFileSync(absolutePath, { encoding: "utf-8" });
                document = TextDocument.create(uri, "typescript", 1, content);
            } else {
                return null;
            }
        }
        const htmlDocument = this.getHtmlDocument(document);
        const sourceFile = this.getSourceFile(document, htmlDocument);
        if (sourceFile) {
            const component = parseComponent(sourceFile);
            if (component) {
                this.cacheVueComponent.set(uri, component);
            }
            return component;
        }
        return null;
    }

    /** 获取注册的组件列表 */
    public getComponents(uri: string): VueComponent[] {
        if (this.cacheComponentsMap.has(uri)) {
            return this.cacheComponentsMap.get(uri) || [];
        }
        const document = this.documents.get(uri);
        if (!document) {
            return [];
        }
        const htmlDocument = this.getHtmlDocument(document);
        const pathList = getComponentsPath(this.getSourceFile(document, htmlDocument));
        const components: VueComponent[] = pathList.map(({ name, path }) => {
            const component = this.getVueComponent(path, uri);
            if (component) {
                return component;
            } else {
                return {
                    uri: getUri(path, uri),
                    name,
                    jsDocComment: "",
                    model: null,
                    props: [],
                };
            }
        });
        this.cacheComponentsMap.set(uri, components);
        return components;
    }

    private getSourceFile(document: TextDocument, htmlDocument: HTMLDocument): ts.SourceFile {
        if (this.cacheSourceFile.has(document.uri)) {
            return this.cacheSourceFile.get(document.uri) as ts.SourceFile;
        }
        // 从 documents 获取
        const scriptString = getScriptString(document, htmlDocument);
        const sourceFile = ts.createSourceFile(document.uri, scriptString, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
        this.cacheSourceFile.set(document.uri, sourceFile);
        return sourceFile;
    }
}

/** 组件基本信息 */
export interface VueComponent {
    uri: string;
    name: string;
    jsDocComment: string;
    model: VueModel | null;
    props: VueProp[];
}

/** 组件属性 */
export interface VueProp {
    name: string;
    type: string;
    required: boolean | "unknown";
    jsDocComment: string;
}

/** 组件 model */
export interface VueModel extends VueProp {
    event: string;
}
