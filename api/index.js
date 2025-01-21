let express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { error } = require("console");
const { DATABASE_URL } = process.env;
require("dotenv").config();

let app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function getPostgresVersion() {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT version()");
        console.log(res.rows[0]);
    } finally {
        client.release();
    }
}

getPostgresVersion();

// Retrieve posts by user ID
app.get("/posts/user/:user_id", async (req, res) => {
    const { user_id } = req.params;
    const client = await pool.connect();

    try {
        const posts = await client.query("SELECT * FROM posts WHERE user_id=$1", [
            user_id,
        ]);
        if (posts.rowCount > 0) {
            res.json(posts.rows);
        } else {
            res.status(404).json({ error: "No posts found for the given user" });
        }
    } catch (error) {
        console.error("Error", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Add new post
app.post("/posts", async (req, res) => {
    const { title, content, user_id } = req.body;
    const client = await pool.connect();
    try {
        // Check if user exists
        const userExists = await client.query("SELECT id FROM users WHERE id=$1", [
            user_id,
        ]);
        if (userExists.rows.length > 0) {
            // User exists, add post
            const post = await client.query(
                "INSERT INTO posts (title, content, user_id) VALUES ($1, $2, $3) RETURNING *",
                [title, content, user_id],
            );
            // Send new post data back to client
            res.json(post.rows[0]);
        } else {
            // User does not exist
            res.status(400).json({ message: "User does not exist" });
        }
    } catch (err) {
        console.error(err.stack);
        res.status(500).send("Something went wrong, please try again later!");
    } finally {
        client.release();
    }
});

// Endpoint to like a post
app.post("/likes", async (req, res) => {
    const { users_id, post_id } = req.body;
    const client = await pool.connect();

    try {
        // check if an inactive like for this user and post already exists
        const prevLike = await client.query(
            `SELECT * FROM likes WHERE users_id = $1 AND post_id = $2 AND active = false`,
            [users_id, post_id],
        );

        if (prevLike.rowCount > 0) {
            // if the inactive like exists, update it to active
            const newLike = await client.query(
                `
      UPDATE likes SET active = true WHERE id = $1 RETURNING *`,
                [prevLike.rows[0].id],
            );
            res.json(newLike.rows[0]);
        } else {
            // if it does not exist, insert new like row with active as true
            const newLike = await client.query(
                `
      INSERT INTO likes (users_id, post_id, created_at,active) VALUES ($1,$2,CURRENT_TIMESTAMP,true) RETURNING *`,
                [users_id, post_id],
            );
            res.json(newLike.rows[0]);
        }
    } catch (error) {
        console.error("Error", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Add a comment to post or comments
app.post("/comments", async (req, res) => {
    const { user_id, post_id, content } = req.body;
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO comments (user_id, post_id, content, created_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP) RETURNING *",
            [user_id, post_id, content],
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occured, please try again.");
    } finally {
        client.release();
    }
});

// Like a comment
app.post("/comments/:id/like", async (req, res) => {
    const { id } = req.params;
    const { user_id } = req.body;
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2) RETURNING *",
            [user_id, id],
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

// Fetch all likes for the specific post
app.get("/likes/post/:post_id", async (req, res) => {
    const { post_id } = req.params;
    const client = await pool.connect();
    try {
        const likes = await client.query(
            "SELECT users.username FROM likes INNER JOIN users ON likes.users_id =users.id WHERE likes.post_id =$1",
            [post_id],
        );
        const usernames = likes.rows.map((like) => like.username);
        res.json(usernames);
    } catch (err) {
        console.error(err.stack);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

// Delete a comment
app.delete("/comments/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query("DELETE FROM comments WHERE id=$1", [id]);
        res.json({ message: "Comment Deleted Successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

// Endpoint to unlike a post
app.put("/likes/:userId/:postId", async (req, res) => {
    const { userId, postId } = req.params;
    const client = await pool.connect();

    try {
        // Update the like row to inactive
        await client.query(
            `UPDATE likes SET active = false WHERE user_id = $1 AND post_id = $2 AND active = true`,
            [userId, postId],
        );
        res.json({ message: "The like has been removed successfully!" });
    } finally {
        client.release();
    }
});

// Edit a comment
app.put("/comments/:id", async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE comments SET content=$1 WHERE id=$2 RETURNING *",
            [content, id],
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

// Retrieve post
app.get("/posts/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        // Fetch the post by ID and increment the views counter
        const postResult = await client.query(
            "SELECT * FROM posts WHERE id = $1 FOR UPDATE",
            [id],
        );
        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: "Post not found" });
        }
        const post = postResult.rows[0];

        // Increment the views counter
        await client.query("UPDATE posts SET views = views + 1 WHERE id = $1", [
            id,
        ]);
        // Fetch the updated post
        const updatedPostResult = await client.query(
            "SELECT * FROM posts WHERE id = $1",
            [id],
        );
        const updatedPost = updatedPostResult.rows[0];
        res.json(updatedPost);
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

// Retrieve comments
app.get("/comments/:post_id", async (req, res) => {
    const { post_id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query(
            "SELECT comments.*, users.username FROM comments INNER JOIN users ON comments.user_id = users.id WHERE comments.post_id = $1 ORDER BY comments.created_at DESC",
            [post_id],
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred, please try again.");
    } finally {
        client.release();
    }
});

app.get("/", (req, res) => {
    res.status(200).json({ message: "Welcome to the twitter API!" });
});

app.listen(3000, () => {
    console.log("App is listening on port 3000");
});
