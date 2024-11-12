const inputValidator = (input) => {
  if (input !== "") {
    return true;
  }
};

module.exports = [
  {
    type: "input",
    name: "slug",
    message: "記事のスラッグを入力してください（URLとして使用されます）",
    validate: inputValidator,
    initial: new Date().toISOString().split("T")[0].replace(/-/g, ""), // 空欄の場合は、本日日付をタイトルとする
  },
  {
    type: "toggle",
    name: "publication_name",
    message: "LCL EngineersのPublicationに紐付けますか？（後で変更可能です）",
    initial: true,
  },
];
