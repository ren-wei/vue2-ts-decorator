import * as fs from 'fs';
import * as ts from "typescript";
import { getLanguageService, TextDocument } from "vscode-html-languageservice";
import VueTextDocuments, { VueTextDocument } from './documents';
import { parseComponent } from './parse';
import { compileTemplate2Render } from './compile';

export const htmlLanguageService = getLanguageService();

const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
};

export const getServicesHost = (documents: VueTextDocuments):ts.LanguageServiceHost => {
    return {
        getScriptFileNames: () => {
            return documents.all().map(getFileName);
        },
        getScriptVersion: fileName => {
            return String(documents.get(getUri(fileName))?.version);
        },
        getScriptSnapshot: fileName => {
            const document = documents.get(fileName.slice(0, fileName.length - 3));
            if (!document) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(getScriptString(document));
        },
        getCurrentDirectory: () => "/",
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: ts.getDefaultLibFileName,
        fileExists: (path: string) => {
            path = path.replace("file://", "");
            return fs.existsSync(path);
        },
        readFile: (path: string) => {
            path = path.replace("file://","");
            return fs.readFileSync(path, { encoding: "utf8" });
        },
    };
};

/** 获取文件名 */
export function getFileName(document: TextDocument) {
    if (document.uri.endsWith(".vue")) {
        return document.uri + ".ts";
    }
    return document.uri;
}

/** 获取文件 uri */
export function getUri(fileName: string) {
    if (fileName.endsWith(".vue.ts")) {
        return fileName.slice(0, fileName.length - 3);
    }
    return fileName;
}

/** 获取 vue 文件中的 ts 部分，将 template 中的表达式依次加入 render 方法中 */
function getScriptString(document: VueTextDocument) {
    document.htmlDocument = htmlLanguageService.parseHTMLDocument(document);
    const template = document.htmlDocument.roots.find(root => root.tag === "template");
    const script = document.htmlDocument.roots.find(root => root.tag === "script");
    if (template && script) {
        let content = document.getText().slice(script.startTagEnd || script.start, script.endTagStart || script.end);
        const ast = ts.createSourceFile("source.ts", content, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
        // 找到组件类
        const component = ast.statements.find(statement => statement.kind === ts.SyntaxKind.ClassDeclaration);
        if (component && ts.isClassDeclaration(component)) {
            /** render 函数插入的位置，以 ts 开始位置为基准 */
            const pos = component.members[component.members.length - 1].end;
            document.vueComponent = parseComponent(ast);
            document.renderStart = pos;
            const propertyList = [
                ...(document.vueComponent.model ? [document.vueComponent.model] : []),
                ...document.vueComponent.props,
                ...document.vueComponent.computedProps,
                ...document.vueComponent.datas,
                ...document.vueComponent.methods
            ];
            const predefineList = propertyList.map(getPropertyName);
            const { render, position } = compileTemplate2Render(
                document.getText().slice(template.start, template.end),
                template,
                document.renderStart,
                predefineList
            );
            document.position = position;
            // 增加 render 函数
            content = content.slice(0, pos) + render + content.slice(pos);
        }
        return content;
    }
    return "";
}

/** 获取属性、计算属性、数据、方法的名称 */
export function getPropertyName(property: ts.PropertyDeclaration | ts.GetAccessorDeclaration | ts.MethodDeclaration) {
    const name = property.name;
    if (ts.isIdentifier(name)) {
        return name.escapedText.toString();
    }
    return "";
}
