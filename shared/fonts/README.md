# ともはねの字体

きせかえの「字体」と、手紙キットの便箋・受け取りページで使う字体です。
どれも SIL Open Font License 1.1（OFL）の字体で、アプリに入れて配ってよいものです（ライセンス文は `OFL-*.txt`）。

| ファイル | 字体 | きせかえでの名前 | 元のファイル |
| --- | --- | --- | --- |
| `ZenMaruGothic-Regular.woff2` | Zen Maru Gothic | まるゴシック | google/fonts `ofl/zenmarugothic` |
| `KleeOne-Regular.woff2` | Klee One | てがき風 | google/fonts `ofl/kleeone` |
| `KiwiMaru-Regular.woff2` | Kiwi Maru | ぽってり丸 | google/fonts `ofl/kiwimaru` |

- ネットから読み込まず、ともはねの中に置いている（家の Wi-Fi だけで使うときも字体が出るように）
- ファイルを軽くするため、よく使う文字だけに減らしている（ひらがな・カタカナ・JIS 第1・第2水準の漢字・記号・英数字。fontTools で作成）。入っていない文字は、ふだんの字体で表示される
- 太字のファイルは入れていない（太字はブラウザが自動で太くする）

## 字体を増やすとき

1. OFL など、再配布してよいライセンスの字体を選ぶ（パソコンに入っている市販の字体は入れられない）
2. 上と同じ文字の範囲で woff2 に減らして、ここに置く。ライセンス文も一緒に置く
3. `shared/fonts.css` に `@font-face` を、`shared/typefaces.js` の `TYPEFACES` に1行足す
4. `shared/kisekae-opinions.js` にキャラのひとことを足す
