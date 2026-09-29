INSERT INTO settings(key,value) VALUES
('pricing', '{"weekday":23000,"friday":30000,"saturday":34000,"dates":{}}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;

INSERT INTO members(id,name,phone,code,note) VALUES
('phone:81db9f11-4dec-4662-850b-7ec5313119c0','Дарья','79221735296','DOM3C574D6B','Даша любимка'),
('zhD5DsuTs9RGhYH10GuSEkTF7ciNyySrC5KZCKyKhyy7pnR4vlaET3','Артём','79090000194','DOMF50C4B69',''),
('phone:0508c388-5a0c-43f5-86c1-e16ef5f3c6e1','Олег','79881540505','DOM81DA47A8','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO point_ledger(member_id,points,kind,reason,request_id) VALUES
('phone:81db9f11-4dec-4662-850b-7ec5313119c0',2,'earned','Перенесено со старого сайта','migration-earned-darya'),
('phone:81db9f11-4dec-4662-850b-7ec5313119c0',1,'deducted','Удаление тестового начисления.','migration-deduction-darya')
ON CONFLICT (request_id) DO NOTHING;

INSERT INTO calendar_blocks(id,arrival,departure,note,kind,created_at) VALUES
('4718a054-afcf-4122-8a08-515e69708da2','2026-09-29','2026-09-30','','blocked','2026-09-28T18:40:14.299Z'),
('4315bfd6-114c-4a8c-b295-d057c512f411','2026-10-02','2026-10-03','','blocked','2026-09-28T18:46:54.548Z'),
('087b16cf-d237-4e08-8f6d-1f0e962b56e6','2026-10-03','2026-10-04','','blocked','2026-09-28T18:40:32.356Z'),
('6f1152c0-50a4-4689-9aaa-4690214bfa6a','2026-10-10','2026-10-11','','blocked','2026-09-28T18:40:40.770Z'),
('fa8d1121-416e-4a24-8fc4-8a32fbbaf1c1','2026-10-12','2026-10-13','','blocked','2026-09-28T18:47:03.765Z'),
('f1c42e08-3c34-4c77-8c20-1443cd1a86ae','2026-10-17','2026-10-18','','blocked','2026-09-28T18:40:48.433Z'),
('04670780-9384-4cd0-bc2c-e80cefdf7374','2026-10-24','2026-10-25','','blocked','2026-09-28T18:47:16.262Z'),
('6eaafbaa-5f27-4854-9b6e-6f96bfa42694','2026-10-26','2026-10-27','Рената бронь','booked','2026-09-29T05:45:16.986Z'),
('5a41e6ae-7e23-47ab-88b9-b641a164fe06','2026-10-29','2026-10-30','','blocked','2026-09-28T18:40:53.992Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bookings(id,user_id,name,phone,arrival,departure,guests,nights,total,referrer,status,created_at,request_key,early_credited,archived,dates_released,telegram_state,telegram_attempted_at)
VALUES ('af8b3090-89ea-461e-a0bf-6e7ee8b1c882','tg:391620785','Артём','79090000194','2026-10-21','2026-10-22',16,1,27000,'phone:81db9f11-4dec-4662-850b-7ec5313119c0','completed','2026-09-29T08:20:26.048Z','23190caf-910f-42a7-bc5a-0863d80790f8',true,false,false,'sent',1790670026295)
ON CONFLICT (id) DO NOTHING;
