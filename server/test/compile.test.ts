import { describe, expect, test } from "@jest/globals";
import { TextDocument } from "vscode-html-languageservice";
import { compileTemplate2Render } from "../src/vue-language-service/compile";
import { htmlLanguageService } from "../src/vue-language-service/host";

describe("compileTemplate2Render", () => {
    test("普通元素应该渲染预定义部分", () => {
        const templateString = [
            "<template>",
            "    <div id=\"app\">",
            " .      <img src=\"../assets/demo.png\" />",
            "    </div>",
            "</template>",
        ].join("\n");
        const renderResult = [
            "render(){",
            "const {} = this;",
            "}",
        ].join("");

        const template = getTemplate(templateString);
        const { render } = compileTemplate2Render(templateString, template, 10, []);
        expect(render).toBe(renderResult);
    });
});

function getTemplate(templateString: string) {
    const document = TextDocument.create("test.vue", "vue", 1, templateString);
    return htmlLanguageService.parseHTMLDocument(document).roots[0];
}
