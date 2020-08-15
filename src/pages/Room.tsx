import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import React, { useEffect, useState } from 'react';
import { RouteComponentProps, useHistory } from 'react-router';
import Chat from '../components/Chat';
import { auth, db, decrement, increment, rtdb } from '../services/firebase';
import { generateAnonName } from '../services/random';

const Room: React.FC<RouteComponentProps<{ roomId: string }>> = ({ match }) => {
  const history = useHistory();
  const roomId = match.params.roomId;

  const [validRoom, setValidRoom] = useState(false);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [didConnect, setDidConnect] = useState(false);

  // Verify that the roomId exists in db
  useEffect(() => {
    const fetchRoom = async () => {
      const room = await db.collection('rooms').doc(roomId).get();
      if (!room.exists) {
        history.push('/');
      } else {
        setValidRoom(true);
      }
    };

    fetchRoom();
  }, [history, roomId]);

  // Handle logging in
  useEffect(() => {
    const authUnsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        const credential = await auth.signInAnonymously();
        await db.collection('users').doc(credential.user?.uid).set({
          name: generateAnonName(),
        });
      }
    });

    return () => {
      authUnsubscribe();
    };
  }, []);

  // Subscribe listeners
  useEffect(() => {
    if (!didConnect && userId !== '' && validRoom) {
      const populateRoom = () => {
        const roomRef = rtdb.ref('/rooms/' + roomId);
        const availableRef = rtdb.ref('/available/');

        // Keep track of online user presence in realtime database rooms
        roomRef.on('value', async (snapshot) => {
          if (!snapshot.hasChild(userId)) {
            // Keep userId in the room as long as a connection from the client exists
            await roomRef.child(userId).set({ name: 'placeholder' });
            await roomRef.update({ userCount: increment });
          }
        });

        roomRef.child('userCount').on('value', (snapshot) => {
          setUserCount(snapshot.val());
        });

        // Re-add room into /available/ if the room was deleted
        availableRef.on('child_removed', async (snapshot) => {
          if (!snapshot.hasChild(roomId)) {
            await availableRef.child(roomId).set({
              name: 'Room Name',
              createdAt: new Date().toISOString(),
            });
          }
        });

        setLoading(false); // Ready when connection to rtdb is made

        // Unsubscribe listeners
        return () => {
          roomRef.off('value');
          roomRef.child('userCount').off('value');
          availableRef.off('child_removed');
        };
      };

      populateRoom();
      setDidConnect(true); // Run this useEffect only once
    }
  }, [userId, validRoom, roomId, userCount, loading, didConnect]);

  // Handle disconnect events
  useEffect(() => {
    if (!loading && userId !== '' && validRoom) {
      const depopulateRoom = async () => {
        const refUser = rtdb.ref('/rooms/' + roomId + '/' + userId);
        const refRoom = rtdb.ref('/rooms/' + roomId);
        const refAvailable = rtdb.ref('/available/' + roomId);

        // Always remove user from room on disconnect
        await refRoom.onDisconnect().update({ userCount: decrement });
        await refUser.onDisconnect().remove();

        // Remove the room if the leaving user is the last in the room
        if (userCount <= 1) {
          await refRoom.onDisconnect().remove();
          await refAvailable.onDisconnect().remove();
        } else {
          await refRoom.onDisconnect().cancel(); // Cancels all disconnect actions at and under refRoom
          await refAvailable.onDisconnect().cancel();
          await refRoom.onDisconnect().update({ userCount: decrement }); // User disconnect still needs to be handled
          await refUser.onDisconnect().remove();
        }
      };

      depopulateRoom();
    }
  }, [userId, validRoom, roomId, loading, userCount]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Turtle</IonTitle>
        </IonToolbar>
      </IonHeader>
      {loading ? (
        <IonContent className="ion-padding">Loading...</IonContent>
      ) : (
        <Chat roomId={roomId} userId={userId}></Chat>
      )}
    </IonPage>
  );
};

export default Room;
