import { existsSync, readFileSync } from "fs";
import * as ts from "typescript";
import { TextDocuments, WorkspaceFolder } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LanguageService as HtmlLanguageService, getLanguageService, HTMLDocument } from "vscode-html-languageservice";
import { getComponentsPath, parseComponent, parseLibraryFile } from "./parse";
import { getAbsolutePath, getScriptString, getUri, resolvePath } from "./tools";

/**
 * 组件管理器
 */
export class ComponentManager {
    public documents: TextDocuments<TextDocument>;

    public workspaceFolders: WorkspaceFolder[] | null;

    public htmlLanguageService: HtmlLanguageService;

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
            // eslint-disable-next-line no-console
            console.log("cacheHtmlDocument");
            return this.cacheHtmlDocument.get(document.uri) as HTMLDocument;
        }
        const htmlDocument = this.htmlLanguageService.parseHTMLDocument(document);
        this.cacheHtmlDocument.set(document.uri, htmlDocument);
        return htmlDocument;
    }

    /**
     * 获取组件
     * @param name 组件名称，如果组件是非默认导出组件，那么需要在路径对应的文件中使用名称进行查找
     * @param path 路径或 uri
     * @param baseUri 如果是相对路径，那么需要当前文件的 uri
     * @returns 组件信息，如果组件不存在，那么返回 null
     */
    public getVueComponent(name: string, path: string, baseUri?: string) {
        const uri = getUri(path, baseUri);
        let cacheKey: string;
        if (uri.endsWith(".vue")) {
            cacheKey = uri;
        } else {
            cacheKey = `${uri}#${name}`;
        }
        // 从缓存中获取
        if (this.cacheVueComponent.has(cacheKey)) {
            // eslint-disable-next-line no-console
            console.log("cacheVueComponent");
            return this.cacheVueComponent.get(cacheKey) as VueComponent;
        }
        let document = this.documents.get(uri);
        if (!document) {
            // 从文件系统获取
            const absolutePath = getAbsolutePath(uri);
            if (existsSync(absolutePath)) {
                const content = readFileSync(absolutePath, { encoding: "utf-8" });
                if (absolutePath.endsWith(".vue")) {
                    document = TextDocument.create(uri, "vue", 1, content);
                } else {
                    document = TextDocument.create(uri, "typescript", 1, content);
                }
            } else {
                // eslint-disable-next-line no-console
                console.warn("(getVueComponent) file not exist:", absolutePath);
                return null;
            }
        }
        const sourceFile = this.getSourceFile(document);
        if (sourceFile) {
            let component: VueComponent;
            if (document.languageId === "vue") {
                component = parseComponent(sourceFile);
            } else {
                component = parseLibraryFile(sourceFile, name);
            }
            component.name = name;
            if (component) {
                this.cacheVueComponent.set(cacheKey, component);
            }
            return component;
        }
        // eslint-disable-next-line no-console
        console.warn("(getVueComponent) sourceFile is null:", uri);
        return null;
    }

    /** 获取注册的组件列表 */
    public getComponents(uri: string): VueComponent[] {
        if (this.cacheComponentsMap.has(uri)) {
            return this.cacheComponentsMap.get(uri) || [];
        }
        const document = this.documents.get(uri);
        if (!document) {
            // eslint-disable-next-line no-console
            console.warn("(getComponents) uri not found in documents:", uri);
            return [];
        }
        const rootPath = this.getRootPath(document.uri) || ".";
        const pathList = getComponentsPath(this.getSourceFile(document), rootPath, this.getCompilerOptions(rootPath));
        const components: VueComponent[] = pathList.map(({ name, path }) => {
            const component = this.getVueComponent(name, path, uri);
            if (component) {
                return component;
            } else {
                // eslint-disable-next-line no-console
                console.warn("component not found:", name);
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

    private getSourceFile(document: TextDocument): ts.SourceFile {
        if (this.cacheSourceFile.has(document.uri)) {
            // eslint-disable-next-line no-console
            console.log("cacheSourceFile");
            return this.cacheSourceFile.get(document.uri) as ts.SourceFile;
        }
        // 从 documents 获取
        let scriptString: string;
        if (document.languageId === "vue") {
            const htmlDocument = this.getHtmlDocument(document);
            scriptString = getScriptString(document, htmlDocument);
        } else {
            scriptString = document.getText();
        }
        const sourceFile = ts.createSourceFile(document.uri, scriptString, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
        this.cacheSourceFile.set(document.uri, sourceFile);
        return sourceFile;
    }

    /** 获取文档的根路径，如果不存在根路径，返回 undefined */
    private getRootPath(uri: string) {
        const rootUri = this.workspaceFolders?.find(folder => uri.startsWith(folder.uri))?.uri;
        if (rootUri) {
            return getAbsolutePath(rootUri);
        }
    }

    /** 根据根路径获取编译选项 */
    private getCompilerOptions(rootPath: string): ts.CompilerOptions {
        const tsConfigPath = resolvePath(rootPath, "./tsconfig.json");
        if (existsSync(tsConfigPath)) {
            const content = readFileSync(tsConfigPath, { encoding: "utf8" });
            try {
                return JSON.parse(content).compilerOptions || {};
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error("[ERROR] tsconfig.json:");
                // eslint-disable-next-line no-console
                console.error(e);
                return {};
            }
        }
        return {};
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
