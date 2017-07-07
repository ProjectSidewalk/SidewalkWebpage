
# --- !Ups
INSERT INTO role (role_id, role) VALUES (3, 'Researcher');

INSERT INTO user_role (user_id, role_id) VALUES
  ('49787727-e427-4835-a153-9af6a83d1ed1', 3), ('9efaca05-53bb-492e-83ab-2b47219ee863', 3),
  ('25b85b51-574b-436e-a9c4-339eef879e78', 3), ('9c828571-eb9d-4723-9e8d-2c00289a6f6a', 3),
  ('5473abc6-38fc-4807-a515-e44cdfb92ca2', 3), ('0c6cb637-05b7-4759-afb2-b0a25b615597', 3),
  ('6acde11f-d9a2-4415-b73e-137f28eaa4ab', 3), ('0082be2e-c664-4c05-9881-447924880e2e', 3),
  ('ae8fc440-b465-4a45-ab49-1964a7f1dcee', 3), ('c4ba8834-4722-4ee1-8f71-4e3fe9af38eb', 3),
  ('41804389-8f0e-46b1-882c-477e060dbe95', 3), ('d8862038-e4dd-48a4-a6d0-69042d9e247a', 3),
  ('43bd82ab-bc7d-4be7-a637-99c92f566ba5', 3), ('0bfed786-ce24-43f9-9c58-084ae82ad175', 3),
  ('b65c0864-7c3a-4ba7-953b-50743a2634f6', 3), ('b6049113-7e7a-4421-a966-887266200d72', 3),
  ('395abc5a-14ea-443c-92f8-85e87fa002be', 3), ('a6611125-51d0-41d1-9868-befcf523e131', 3),
  ('1dc2f78e-f722-4450-b14e-b21b232ecdef', 3), ('ee570f03-7bca-471e-a0dc-e7924dac95a4', 3),
  ('23fce322-9f64-4e95-90fc-7141f755b2a1', 3), ('c846ef76-39c1-4a53-841c-6588edaac09b', 3),
  ('74b56671-c9b0-4052-956e-02083cbb5091', 3), ('fe724938-797a-48af-84e9-66b6b86b6245', 3);

# --- !Downs
DELETE FROM role WHERE (role_id = 3 AND role = 'Researcher');

DELETE FROM user_role WHERE role_id = 3;
