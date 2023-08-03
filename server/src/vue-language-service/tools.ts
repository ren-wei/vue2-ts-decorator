import { resolve } from "path";
import { HTMLDocument, TextDocument } from "vscode-html-languageservice";

/** 获取绝对路径 */
export function getAbsolutePath(uri: string): string {
    return uri.replace("file://", "");
}

/** 根据相对路径获取 uri */
export function getUri(path: string, baseUri?: string): string {
    if (baseUri) {
        return "file://" + resolve(getAbsolutePath(baseUri), "..", path);
    }
    return path;
}

/** 从绝对路径获取 uri */
export function getUriFromAbsolutePath(absolutePath: string): string {
    return "file://" + absolutePath;
}

/** 获取 ts 脚本字符串 */
export function getScriptString(document: TextDocument, htmlDocument: HTMLDocument) {
    const node = htmlDocument.roots.find(root => root.tag === "script");
    if (node) {
        return document.getText().slice(node.startTagEnd, node.endTagStart);
    }
    return "";
}
