# Backend ハッピーパス手動テスト

1. プロジェクト作成  
   `curl -X POST http://localhost:3001/projects -H "Content-Type: application/json" -H "x-user-id: admin" -H "x-roles: admin,mgmt" -d '{"code":"PRJ-HP","name":"Happy Path"}'`
2. 見積作成  
   `curl -X POST http://localhost:3001/projects/<projectId>/estimates -H "x-user-id: admin" -H "x-roles: admin,mgmt" -d '{"totalAmount":100000,"currency":"JPY","lines":[]}'`
3. 見積送付（承認起動）  
   `curl -X POST http://localhost:3001/estimates/<estimateId>/submit -H "x-user-id: admin" -H "x-roles: admin,mgmt"`
4. 請求作成  
   `curl -X POST http://localhost:3001/projects/<projectId>/invoices -H "x-user-id: admin" -H "x-roles: admin,mgmt" -d '{"estimateId":"<estimateId>","totalAmount":100000,"currency":"JPY","lines":[]}'`
5. 請求送信（ステータスsent）  
   `curl -X POST http://localhost:3001/invoices/<invoiceId>/send -H "x-user-id: admin" -H "x-roles: admin,mgmt"`
6. 工数入力/取得  
   POST `/time-entries` -> GET `/time-entries`
7. 経費入力/取得  
   POST `/expenses` -> GET `/expenses`
8. アラートジョブ実行  
   `curl -X POST http://localhost:3001/jobs/alerts/run`
9. 損益レポート取得  
   `curl -X GET http://localhost:3001/reports/project-profit/<projectId> -H "x-user-id: admin" -H "x-roles: admin,mgmt"`

期待結果: 5xxエラーなく、status=200/201が返ること。請求・工数・経費が取得できること。
