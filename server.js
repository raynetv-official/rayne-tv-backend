import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    name: "RAYNE TV Backend",
    status: "online",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RAYNE TV backend running on port ${PORT}`);
});
